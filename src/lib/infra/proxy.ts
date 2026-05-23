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

const PROXY_SCHEME = "proxy";
const SETTINGS_STORAGE_KEY = "open-builder-settings";

// ─── State ───────────────────────────────────────────────────────────────────

let proxyEnabled = false;
let installed = false;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Dynamically enable or disable the proxy at runtime.
 * Called by the settings panel when the user toggles the switch.
 */
export function setProxyEnabled(enabled: boolean) {
  proxyEnabled = enabled;
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

    return true;
  } catch {
    return false;
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
