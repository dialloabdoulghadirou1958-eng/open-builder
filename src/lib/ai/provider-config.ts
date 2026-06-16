export type ApiType = "openai-compatible" | "openai" | "anthropic" | "google";

/** Default API base URLs without version suffixes. */
export const DEFAULT_BASE_URLS: Record<ApiType, string> = {
  "openai-compatible": "http://localhost:11434",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
};

const DEFAULT_VERSION_PATHS: Record<ApiType, string> = {
  "openai-compatible": "/v1",
  openai: "/v1",
  anthropic: "/v1",
  google: "/v1beta",
};

export interface ProviderConfig {
  apiType: ApiType;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

function hasVersionPath(url: string): boolean {
  return /\/v\d+(\w*)$/.test(url);
}

export function resolveBaseURL(url: string, apiType: ApiType): string {
  const cleaned = url.replace(/\/+$/, "");
  if (hasVersionPath(cleaned)) return cleaned;
  return cleaned + DEFAULT_VERSION_PATHS[apiType];
}

export async function fetchModelList(
  apiType: ApiType,
  apiBaseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  switch (apiType) {
    case "openai-compatible":
    case "openai": {
      const url = `${baseURL}/models`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.data || [])
        .map((m: { id?: string }) => m.id)
        .filter(Boolean)
        .sort() as string[];
    }

    case "anthropic": {
      const url = `${baseURL}/models`;
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.data || [])
        .map((m: { id?: string }) => m.id)
        .filter(Boolean)
        .sort() as string[];
    }

    case "google": {
      const url = `${baseURL}/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.models || [])
        .map((m: { name?: string }) => m.name?.replace(/^models\//, ""))
        .filter(Boolean)
        .sort() as string[];
    }

    default:
      return [];
  }
}
