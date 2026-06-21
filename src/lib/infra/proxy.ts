// ============================================================================
//  proxy.ts
//  Global fetch & XMLHttpRequest interceptor for Tauri custom protocol proxy.
//  Rewrites external HTTP(S) requests to proxy://{host}/{path} so that the
//  Rust backend can forward them via reqwest, bypassing CORS restrictions.
//
//  Streaming requests (SSE) are routed through the Tauri invoke + Events
//  bridge instead of the custom protocol, enabling real-time token streaming.
// ============================================================================

import { createSseResponse } from "./sse-bridge";
import { invoke } from "@tauri-apps/api/core";

const PROXY_SCHEME = "proxy";
const SETTINGS_STORAGE_KEY = "open-builder-settings";
const MAX_PROXY_ALLOWED_HOSTS = 64;
const MAX_PROXY_HOST_CHARS = 253;
const HOSTNAME_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// ─── State ───────────────────────────────────────────────────────────────────

let proxyEnabled = false;
let proxyAllowedHosts: string[] = [];
let proxyLog: ProxyLogEntry[] = [];
let installed = false;

export interface ProxyLogEntry {
  timestamp: number;
  kind: "fetch" | "xhr" | "sse";
  method: string;
  host: string;
  path: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Dynamically enable or disable the proxy at runtime.
 * Called by the settings panel when the user toggles the switch.
 */
export function setProxyEnabled(enabled: boolean) {
  proxyEnabled = enabled;
}

export function parseProxyAllowedHosts(value: string): string[] {
  const out = new Set<string>();
  for (const item of value.split(/[\n,]/)) {
    const normalized = normalizeProxyHostRule(item);
    if (!normalized) continue;
    out.add(normalized);
    if (out.size >= MAX_PROXY_ALLOWED_HOSTS) break;
  }
  return Array.from(out);
}

export function setProxyAllowedHosts(hosts: string[] | string) {
  proxyAllowedHosts = Array.isArray(hosts)
    ? hosts
        .map(normalizeProxyHostRule)
        .filter((host): host is string => Boolean(host))
        .slice(0, MAX_PROXY_ALLOWED_HOSTS)
    : parseProxyAllowedHosts(hosts);
  syncProxyPolicy();
}

export function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = normalizeHostName(hostname);
  if (!host) return false;
  if (allowedHosts.length === 0) return isLoopbackHost(host);
  return allowedHosts.some((rawAllowed) => {
    const allowed = normalizeProxyHostRule(rawAllowed);
    if (!allowed) return false;
    if (allowed === host) return true;
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return false;
	  });
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHostName(hostname);
  if (!host) return false;
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function addHostFromUrl(out: Set<string>, rawUrl: unknown): void {
  if (typeof rawUrl !== "string" || !rawUrl) return;
  try {
    const parsed = new URL(rawUrl);
    const host = normalizeProxyHostRule(parsed.hostname);
    if (host) out.add(host);
  } catch {
    // Ignore incomplete settings while the user is typing.
  }
}

function normalizeHostName(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.length > MAX_PROXY_HOST_CHARS) return null;
  return host;
}

export function normalizeProxyHostRule(input: string): string | null {
  let raw = input.trim().toLowerCase();
  if (!raw) return null;

  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).hostname;
    } else if (/^[a-z0-9.-]+:\d+$/i.test(raw)) {
      raw = new URL(`http://${raw}`).hostname;
    }
  } catch {
    return null;
  }

  raw = raw.replace(/^\[|\]$/g, "");
  if (!raw || raw.length > MAX_PROXY_HOST_CHARS) return null;

  if (raw.startsWith("*.")) {
    const suffix = raw.slice(2);
    return HOSTNAME_RE.test(suffix) ? `*.${suffix}` : null;
  }

  if (raw === "localhost" || HOSTNAME_RE.test(raw)) return raw;
  if (raw.includes(":")) {
    try {
      const parsed = new URL(`http://[${raw}]`);
      return parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

function readConfiguredApiHosts(): string[] {
  const hosts = new Set<string>();
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    addHostFromUrl(hosts, data?.state?.ai?.apiBaseUrl);
  } catch {
    // Ignore malformed local settings.
  }
  addHostFromUrl(hosts, import.meta.env.VITE_MOHUA_API_URL);
  return [...hosts];
}

function effectiveAllowedHosts(): string[] {
  return [...new Set([...proxyAllowedHosts, ...readConfiguredApiHosts()])];
}

function syncProxyPolicy(): void {
  if (!isTauri()) return;
  void invoke("set_proxy_policy", {
    policy: { allowed_hosts: effectiveAllowedHosts() },
  })
    .catch((err) => {
      console.warn("[proxy] Failed to sync proxy policy:", err);
    });
}

export function getProxyLog(): ProxyLogEntry[] {
  return [...proxyLog];
}

export function clearProxyLog(): void {
  proxyLog = [];
}

/**
 * Check if the proxy is currently enabled.
 */
export function isProxyEnabled(): boolean {
  return proxyEnabled;
}

/**
 * Detect whether running inside a Tauri WebView.
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

/**
 * Install the global proxy interceptor.
 * Must be called once, early in the application lifecycle (before any API calls).
 * Only activates when running inside Tauri.
 */
export function installProxy(): void {
  if (installed) return;

  if (!isTauri()) {
    return;
  }

	  // Read initial setting from localStorage
	  proxyEnabled = readProxySetting();
	  setProxyAllowedHosts(readProxyAllowedHosts());
	  syncProxyPolicy();

  hijackFetch();
  hijackXHR();

  installed = true;
  console.log("[proxy] Interceptor installed (enabled:", proxyEnabled, ")");
}

// ─── URL Helpers ─────────────────────────────────────────────────────────────

/**
 * Determine if a URL should be proxied.
 */
function shouldProxy(url: string): boolean {
  if (!proxyEnabled) return false;

  // Already proxied
  if (url.startsWith(`${PROXY_SCHEME}://`)) return false;

  // Skip non-HTTP(S) protocols
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;

  try {
    const parsed = new URL(url, window.location.href);

    // Only proxy http and https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    // Don't proxy same-origin requests (dev server, tauri app, etc.)
    if (parsed.origin === window.location.origin) return false;

	    if (!isHostAllowed(parsed.hostname, effectiveAllowedHosts())) return false;

    return true;
  } catch {
    return false;
  }
}

function recordProxyRequest(
  kind: ProxyLogEntry["kind"],
  method: string,
  rawUrl: string,
): void {
  try {
    const parsed = new URL(rawUrl, window.location.href);
    proxyLog = [
      ...proxyLog.slice(-99),
      {
        timestamp: Date.now(),
        kind,
        method,
        host: parsed.host,
        path: parsed.pathname,
      },
    ];
  } catch {
    // Ignore malformed URLs; shouldProxy already rejects them.
  }
}

/**
 * Rewrite an external URL to the proxy:// scheme.
 *
 * https://api.openai.com/v1/chat/completions?stream=true
 *   → proxy://api.openai.com/v1/chat/completions?stream=true
 *
 * http://localhost:11434/v1/chat/completions
 *   → proxy://localhost:11434/v1/chat/completions
 *
 * The Rust side infers HTTP vs HTTPS based on the host (IP → HTTP, domain → HTTPS).
 */
function toProxyUrl(originalUrl: string): string {
  const parsed = new URL(originalUrl);
  return `${PROXY_SCHEME}://${parsed.host}${parsed.pathname}${parsed.search}`;
}

/**
 * Extract URL string from various fetch input types.
 */
function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

// ─── Read initial setting ────────────────────────────────────────────────────

function readProxySetting(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data?.state?.system?.reverseProxy === true;
  } catch {
    return false;
  }
}

function readProxyAllowedHosts(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return "";
    const data = JSON.parse(raw);
    return data?.state?.system?.reverseProxyAllowedHosts ?? "";
  } catch {
    return "";
  }
}

// ─── Streaming Detection ─────────────────────────────────────────────────────

/**
 * Detect if a fetch request is a streaming SSE request.
 *
 * - OpenAI / Anthropic / Compatible: JSON body contains "stream":true
 * - Google Gemini: URL path contains ":streamGenerateContent"
 */
function isStreamingRequest(url: string, init?: RequestInit): boolean {
  if (url.includes(":streamGenerateContent")) return true;

  if (init?.body && typeof init.body === "string") {
    if (/"stream"\s*:\s*true/.test(init.body)) return true;
  }

  return false;
}

/**
 * Extract headers from RequestInit into a plain Record for invoke.
 */
function extractHeaders(init?: RequestInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!init?.headers) return result;

  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      result[key] = value;
    });
  } else if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) {
      result[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(init.headers)) {
      result[key] = value;
    }
  }

  return result;
}

// ─── Fetch Hijack ────────────────────────────────────────────────────────────

function hijackFetch(): void {
  const originalFetch = window.fetch;

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const rawUrl = extractUrl(input);

    if (!shouldProxy(rawUrl)) {
      return originalFetch.call(window, input, init);
    }

    // Streaming requests → SSE bridge (Tauri invoke + Events)
    if (isStreamingRequest(rawUrl, init)) {
      console.debug(`[proxy] SSE stream: ${rawUrl}`);
      recordProxyRequest(
        "sse",
        init?.method ?? (input instanceof Request ? input.method : "POST"),
        rawUrl,
      );
      return createSseResponse({
        url: rawUrl,
        method:
          init?.method ??
          (input instanceof Request ? input.method : "POST"),
        headers: extractHeaders(init),
        body: typeof init?.body === "string" ? init.body : undefined,
        signal: init?.signal ?? undefined,
      });
    }

    // Non-streaming requests → proxy:// custom protocol
    const proxiedUrl = toProxyUrl(rawUrl);
    console.debug(`[proxy] fetch: ${rawUrl} → ${proxiedUrl}`);
    recordProxyRequest(
      "fetch",
      init?.method ?? (input instanceof Request ? input.method : "GET"),
      rawUrl,
    );

    // Preserve Request properties (method, headers, body, signal, etc.)
    if (input instanceof Request) {
      const newRequest = new Request(proxiedUrl, input);
      return originalFetch.call(window, newRequest, init);
    }

    return originalFetch.call(window, proxiedUrl, init);
  };
}

// ─── XHR Hijack ──────────────────────────────────────────────────────────────

function hijackXHR(): void {
  const originalOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async_?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const rawUrl = typeof url === "string" ? url : url.href;

    if (shouldProxy(rawUrl)) {
      const proxiedUrl = toProxyUrl(rawUrl);
      console.debug(`[proxy] XHR: ${rawUrl} → ${proxiedUrl}`);
      recordProxyRequest("xhr", method, rawUrl);
      return originalOpen.call(
        this,
        method,
        proxiedUrl,
        async_ ?? true,
        username,
        password,
      );
    }

    return originalOpen.call(
      this,
      method,
      url as string,
      async_ ?? true,
      username,
      password,
    );
  };
}
