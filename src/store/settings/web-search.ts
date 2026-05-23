import type { StateCreator } from "zustand";

export const SERVER_ENGINE = "server" as const;

export interface WebSearchSettings {
  engine:
    | "tavily"
    | "firecrawl"
    | "builtin"
    | "disabled"
    | typeof SERVER_ENGINE;
  tavilyApiKey: string;
  tavilyApiUrl: string;
  firecrawlApiKey: string;
  firecrawlApiUrl: string;
  backendProvider?: string;
}

export const webSearchDefaults: WebSearchSettings = {
  engine: "disabled",
  tavilyApiKey: "",
  tavilyApiUrl: "https://api.tavily.com",
  firecrawlApiKey: "",
  firecrawlApiUrl: "https://api.firecrawl.dev",
};

export interface WebSearchSlice {
  webSearch: WebSearchSettings;
  setWebSearch: (settings: WebSearchSettings) => void;
  isWebSearchConfigured: () => boolean;
}

export const createWebSearchSlice: StateCreator<
  WebSearchSlice,
  [],
  [],
  WebSearchSlice
> = (set, get) => ({
  webSearch: webSearchDefaults,
  setWebSearch: (settings) => set({ webSearch: settings }),
  isWebSearchConfigured: () => {
    const { webSearch } = get();
    if (webSearch.engine === "disabled") return false;
    if (webSearch.engine === "builtin") return true;
    if (webSearch.engine === "tavily") return !!webSearch.tavilyApiKey;
    if (webSearch.engine === "firecrawl") return !!webSearch.firecrawlApiKey;
    return false;
  },
});
