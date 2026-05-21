import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ApiType } from "../lib/ai-provider";
import type { ServerModel, SearchProvider, AssetProvider } from "../lib/mohua-api";

// ─── Types ────────────────────────────────────────────────────────────────────

export const SERVER_ENGINE = "server" as const;

export interface AISettings {
  apiType: ApiType;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
}

export interface WebSearchSettings {
  engine: "tavily" | "firecrawl" | "builtin" | "disabled" | typeof SERVER_ENGINE;
  tavilyApiKey: string;
  tavilyApiUrl: string;
  firecrawlApiKey: string;
  firecrawlApiUrl: string;
  backendProvider?: string;
}

export interface AssetSearchSettings {
  engine: "pixabay" | "unsplash" | "disabled" | typeof SERVER_ENGINE;
  pixabayApiKey: string;
  pixabayApiUrl: string;
  unsplashApiKey: string;
  unsplashApiUrl: string;
  backendProvider?: string;
}

export interface ServerServiceSettings {
  selectedModel: string; // 用户选择的服务端模型 ID
  webSearchEnabled: boolean; // 是否启用服务端联网搜索（默认 true）
  webSearchProviderId: string; // 选择的搜索供应商 ID（空 = 使用默认）
  assetSearchEnabled: boolean; // 是否启用服务端素材搜索（默认 true）
  assetSearchProviderId: string; // 选择的素材供应商 ID（空 = 使用默认）
}

export type Language = "system" | "zh" | "en";
export type Theme = "system" | "light" | "dark";

export interface SystemSettings {
  language: Language;
  theme: Theme;
  reverseProxy: boolean;
}

export interface ModelCache {
  models: string[];
  apiType: string;
  apiBaseUrl: string;
  apiKey: string;
}

export interface ServerServiceCache {
  models: ServerModel[];
  searchProviders: SearchProvider[];
  assetProviders: AssetProvider[];
  timestamp: number;
}

interface SettingsState {
  ai: AISettings;
  webSearch: WebSearchSettings;
  assetSearch: AssetSearchSettings;
  system: SystemSettings;
  serverService: ServerServiceSettings;
  modelCache: ModelCache | null;
  serverServiceCache: ServerServiceCache | null;

  setAI: (settings: AISettings) => void;
  setWebSearch: (settings: WebSearchSettings) => void;
  setAssetSearch: (settings: AssetSearchSettings) => void;
  setSystem: (settings: SystemSettings) => void;
  setServerService: (patch: Partial<ServerServiceSettings>) => void;
  setModelCache: (cache: ModelCache) => void;
  clearModelCache: () => void;
  setServerServiceCache: (cache: ServerServiceCache | null) => void;
  patchServerServiceCache: (patch: Partial<ServerServiceCache>) => void;
  resetAll: () => void;
  isAIValid: () => boolean;
  isWebSearchConfigured: () => boolean;
  isAssetSearchConfigured: () => boolean;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ai: {
        apiType: "openai-compatible",
        apiKey: "",
        apiBaseUrl: "",
        model: "",
      },
      webSearch: {
        engine: "disabled",
        tavilyApiKey: "",
        tavilyApiUrl: "https://api.tavily.com",
        firecrawlApiKey: "",
        firecrawlApiUrl: "https://api.firecrawl.dev",
      },
      assetSearch: {
        engine: "disabled",
        pixabayApiKey: "",
        pixabayApiUrl: "https://pixabay.com/api",
        unsplashApiKey: "",
        unsplashApiUrl: "https://api.unsplash.com",
      },
      system: {
        language: "system" as Language,
        theme: "system" as Theme,
        reverseProxy: false,
      },
      serverService: {
        selectedModel: "",
        webSearchEnabled: true,
        webSearchProviderId: "",
        assetSearchEnabled: true,
        assetSearchProviderId: "",
      },
      modelCache: null,
      serverServiceCache: null,

      setAI: (settings) =>
        set({
          ai: {
            ...settings,
            apiBaseUrl: settings.apiBaseUrl.replace(/\/+$/, ""),
          },
        }),
      setWebSearch: (settings) => set({ webSearch: settings }),
      setAssetSearch: (settings) => set({ assetSearch: settings }),
      setSystem: (settings) => set({ system: settings }),
      setServerService: (patch) =>
        set((state) => ({
          serverService: { ...state.serverService, ...patch },
        })),
      setModelCache: (cache) => set({ modelCache: cache }),
      clearModelCache: () => set({ modelCache: null }),
      setServerServiceCache: (cache) => set({ serverServiceCache: cache }),
      patchServerServiceCache: (patch) =>
        set((state) => {
          const current = state.serverServiceCache;
          if (
            current &&
            (patch.models === undefined || patch.models === current.models) &&
            (patch.searchProviders === undefined || patch.searchProviders === current.searchProviders) &&
            (patch.assetProviders === undefined || patch.assetProviders === current.assetProviders) &&
            patch.timestamp === undefined
          ) {
            return state;
          }
          return {
            serverServiceCache: {
              models: current?.models ?? [],
              searchProviders: current?.searchProviders ?? [],
              assetProviders: current?.assetProviders ?? [],
              ...patch,
              timestamp: patch.timestamp ?? Date.now(),
            },
          };
        }),

      resetAll: () => {
        set({
          ai: {
            apiType: "openai-compatible",
            apiKey: "",
            apiBaseUrl: "",
            model: "",
          },
          webSearch: {
            engine: "disabled",
            tavilyApiKey: "",
            tavilyApiUrl: "https://api.tavily.com",
            firecrawlApiKey: "",
            firecrawlApiUrl: "https://api.firecrawl.dev",
          },
          assetSearch: {
            engine: "disabled",
            pixabayApiKey: "",
            pixabayApiUrl: "https://pixabay.com/api",
            unsplashApiKey: "",
            unsplashApiUrl: "https://api.unsplash.com",
          },
          system: {
            language: "system" as Language,
            theme: "system" as Theme,
            reverseProxy: false,
          },
          modelCache: null,
          serverServiceCache: null,
        });
      },

      isAIValid: () => {
        const { ai } = get();
        return !!(ai.apiKey && ai.apiBaseUrl && ai.model);
      },

      isWebSearchConfigured: () => {
        const { webSearch } = get();
        if (webSearch.engine === "disabled") return false;
        if (webSearch.engine === "builtin") return true;
        if (webSearch.engine === "tavily") return !!webSearch.tavilyApiKey;
        if (webSearch.engine === "firecrawl")
          return !!webSearch.firecrawlApiKey;
        return false;
      },

      isAssetSearchConfigured: () => {
        const { assetSearch } = get();
        if (assetSearch.engine === "disabled") return false;
        if (assetSearch.engine === "pixabay")
          return !!assetSearch.pixabayApiKey;
        if (assetSearch.engine === "unsplash")
          return !!assetSearch.unsplashApiKey;
        return false;
      },
    }),
    {
      name: "open-builder-settings",
      version: 7,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        ai: state.ai,
        webSearch: state.webSearch,
        assetSearch: state.assetSearch,
        system: state.system,
        serverService: state.serverService,
        serverServiceCache: state.serverServiceCache,
      }),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, any>;
        if (version === 0 && state.ai?.apiUrl) {
          let baseUrl: string = state.ai.apiUrl;
          // Strip /chat/completions suffix (works with /v1, /v3, etc.)
          baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
          state.ai.apiBaseUrl = baseUrl.replace(/\/+$/, "");
          delete state.ai.apiUrl;
        }
        if (version < 2) {
          if (!state.webSearch) state.webSearch = {};
          state.webSearch.engine = state.webSearch.tavilyApiKey
            ? "tavily"
            : "disabled";
          state.webSearch.firecrawlApiKey = "";
          state.webSearch.firecrawlApiUrl = "https://api.firecrawl.dev";
        }
        if (version < 3) {
          if (!state.assetSearch) {
            state.assetSearch = {
              engine: "disabled",
              pixabayApiKey: "",
              pixabayApiUrl: "https://pixabay.com/api",
              unsplashApiKey: "",
              unsplashApiUrl: "https://api.unsplash.com",
            };
          }
        }
        if (version < 4) {
          if (!state.ai) state.ai = {};
          if (!state.ai.apiType) {
            state.ai.apiType = "openai-compatible";
          }
        }
        if (version < 5) {
          if (!state.system) state.system = {};
          if (state.system.reverseProxy === undefined) {
            state.system.reverseProxy = false;
          }
        }
        if (version < 7) {
          if (!state.serverService) {
            state.serverService = {
              selectedModel: "",
              webSearchEnabled: true,
              webSearchProviderId: "",
              assetSearchEnabled: true,
              assetSearchProviderId: "",
            };
          }
        }
        // version 6: added "builtin" to webSearch.engine — no data migration needed
        return state as any;
      },
    },
  ),
);
