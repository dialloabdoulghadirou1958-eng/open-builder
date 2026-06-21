import type {
  ServerModel,
  SearchProvider,
  SearchResult,
  AssetProvider,
  AssetSearchResult,
} from "../../types/api";

export type {
  ServerModel,
  SearchProvider,
  SearchResult,
  AssetProvider,
  AssetSearchResult,
} from "../../types/api";

export interface MohuaAuthProvider {
  getToken: () => Promise<string | null>;
  refreshToken: () => Promise<string | null>;
  clearAuth: () => void;
}

export const MOHUA_API_LIMITS = {
  maxJsonBytes: 2 * 1024 * 1024,
  maxCatalogItems: 200,
  maxTextChars: 160,
} as const;

let authProvider: MohuaAuthProvider | null = null;

export function setMohuaAuthProvider(provider: MohuaAuthProvider): void {
  authProvider = provider;
}

export function getMohuaApiUrl(): string | null {
  const url = import.meta.env.VITE_MOHUA_API_URL;
  if (!url) return null;
  const baseUrl = url.replace(/\/+$/, "");
  if (baseUrl.endsWith("/api/v1")) return baseUrl;
  return `${baseUrl}/api/v1`;
}

export function isMohuaEnabled(): boolean {
  return getMohuaApiUrl() !== null;
}

async function authedFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  if (!authProvider) {
    throw new Error("Mohua auth provider not initialized");
  }
  const token = await authProvider.getToken();
  if (!token) {
    throw new Error("Unauthorized");
  }

  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const newToken = await authProvider.refreshToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      response = await fetch(url, { ...options, headers });
    }
  }

  if (response.status === 401) {
    authProvider.clearAuth();
    throw new Error("Session expired. Please log in again.");
  }

  return response;
}

async function mohuaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getMohuaApiUrl();
  if (!baseUrl) {
    throw new Error("Mohua API URL not configured");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const response = await authedFetch(url, options);

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return readJsonWithLimit(response) as Promise<T>;
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > MOHUA_API_LIMITS.maxJsonBytes) {
      throw new Error("API response is too large.");
    }
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MOHUA_API_LIMITS.maxJsonBytes) {
    throw new Error("API response is too large.");
  }
  return JSON.parse(text);
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return "";
  return text.slice(0, MOHUA_API_LIMITS.maxTextChars);
}

function limitCatalog<T>(items: unknown, mapItem: (item: any) => T | null): T[] {
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  for (const item of items) {
    const mapped = mapItem(item);
    if (!mapped) continue;
    out.push(mapped);
    if (out.length >= MOHUA_API_LIMITS.maxCatalogItems) break;
  }
  return out;
}

export async function fetchServerModels(): Promise<ServerModel[]> {
  const res = await mohuaFetch<{ data: any[] }>("/models");
  return limitCatalog(res.data, (m) => {
    const id = cleanText(m?.id);
    if (!id) return null;
    const context =
      typeof m?.context_length === "number" && Number.isFinite(m.context_length)
        ? Math.max(1, Math.min(Math.floor(m.context_length), 10_000_000))
        : 128000;
    return {
      id,
      displayName: cleanText(m?.name) || id,
      maxContextTokens: context,
    };
  });
}

export async function fetchSearchProviders(): Promise<SearchProvider[]> {
  const res = await mohuaFetch<{ data: SearchProvider[] }>("/search");
  return limitCatalog(res.data, (provider) => {
    const id = cleanText(provider?.id);
    const name = cleanText(provider?.name);
    const slug = cleanText(provider?.slug);
    return id && name && slug ? { id, name, slug } : null;
  });
}

export async function serverWebSearch(params: {
  query: string;
  providerId?: string;
  maxResults?: number;
}): Promise<SearchResult[]> {
  return mohuaFetch<SearchResult[]>("/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function fetchAssetProviders(): Promise<AssetProvider[]> {
  const res = await mohuaFetch<{ data: AssetProvider[] }>("/asset");
  return limitCatalog(res.data, (provider) => {
    const id = cleanText(provider?.id);
    const name = cleanText(provider?.name);
    const slug = cleanText(provider?.slug);
    return id && name && slug ? { id, name, slug } : null;
  });
}

export async function serverAssetSearch(params: {
  query: string;
  providerId?: string;
  image_type?: string;
  orientation?: string;
  color?: string;
  per_page?: number;
}): Promise<AssetSearchResult> {
  return mohuaFetch<AssetSearchResult>("/asset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}
