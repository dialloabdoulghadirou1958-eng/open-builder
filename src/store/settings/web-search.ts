import type { StateCreator } from "zustand";

export interface WebSearchSettings {
  engine: "tavily" | "firecrawl" | "builtin" | "disabled";
  tavilyApiKey: string;
  firecrawlApiKey: string;
}

export const webSearchDefaults: WebSearchSettings = {
  engine: "disabled",
  tavilyApiKey: "",
  firecrawlApiKey: "",
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
