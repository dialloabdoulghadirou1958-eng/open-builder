export const SETTINGS_VERSION = 12;

let stashedApiKey: string | null = null;

/** Drain the apiKey that v8→v9 migration peeled off the persisted state.
 *  Consumed once by the secrets store boot — returns null on subsequent reads. */
export function takeStashedApiKey(): string | null {
  const v = stashedApiKey;
  stashedApiKey = null;
  return v;
}

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
    if (state.system.reverseProxyAllowedHosts === undefined) {
      state.system.reverseProxyAllowedHosts = "";
    }
  }
  if (version < 8) {
    if (!state.system) state.system = {};
    if (state.system.planModeEnabled === undefined) {
      state.system.planModeEnabled = false;
    }
  }
  if (version < 9) {
    // Move plaintext apiKey out of localStorage into the encrypted vault.
    // The actual write happens asynchronously from the secrets store boot;
    // stash the value here so it survives the rehydrate cycle.
    if (state.ai && typeof state.ai.apiKey === "string" && state.ai.apiKey) {
      stashedApiKey = state.ai.apiKey;
      state.ai.apiKey = "";
    }
  }
  if (version < 10) {
    if (!state.system) state.system = {};
    if (state.system.reverseProxyAllowedHosts === undefined) {
      state.system.reverseProxyAllowedHosts = "";
    }
  }
  if (version < 11) {
    if (!state.system) state.system = {};
    if (state.system.autoQaEnabled === undefined) {
      state.system.autoQaEnabled = false;
    }
  }
  if (version < 12) {
    if (state.webSearch?.engine === "server") {
      state.webSearch.engine = "disabled";
    }
    if (state.webSearch) delete state.webSearch.backendProvider;

    if (state.assetSearch?.engine === "server") {
      state.assetSearch.engine = "disabled";
    }
    if (state.assetSearch) delete state.assetSearch.backendProvider;

    delete state.serverService;
    delete state.serverServiceCache;
    delete state.modelCache;
  }
  return state;
}
