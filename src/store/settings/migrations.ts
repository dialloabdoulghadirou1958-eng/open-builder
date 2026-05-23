export const SETTINGS_VERSION = 8;

export function migrateSettings(persisted: unknown, version: number): unknown {
  const state = persisted as Record<string, any>;
  if (version === 0 && state.ai?.apiUrl) {
    let baseUrl: string = state.ai.apiUrl;
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
  if (version < 8) {
    if (!state.system) state.system = {};
    if (state.system.planModeEnabled === undefined) {
      state.system.planModeEnabled = false;
    }
  }
  return state;
}
