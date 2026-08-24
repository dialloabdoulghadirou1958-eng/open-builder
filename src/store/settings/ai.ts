import type { StateCreator } from "zustand";
import type { ApiType } from "../../lib/ai/provider-config";
import { useSecretsStore } from "../secrets";

export interface AISettings {
  apiType: ApiType;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
}

export const aiDefaults: AISettings = {
  apiType: "openai-compatible",
  apiKey: "",
  apiBaseUrl: "",
  model: "",
};

export interface ModelCache {
  models: string[];
  apiType: string;
  apiBaseUrl: string;
  apiKey: string;
}

export interface AISlice {
  ai: AISettings;
  modelCache: ModelCache | null;
  setAI: (settings: AISettings) => void;
  setModelCache: (cache: ModelCache) => void;
  clearModelCache: () => void;
  isAIValid: () => boolean;
}

export const createAISlice: StateCreator<AISlice, [], [], AISlice> = (
  set,
  get,
) => ({
  ai: aiDefaults,
  modelCache: null,
  setAI: (settings) => {
    const normalized = {
      ...settings,
      apiBaseUrl: settings.apiBaseUrl.replace(/\/+$/, ""),
    };
    set({ ai: normalized });
    // Persist apiKey to the encrypted vault (not localStorage).
    void useSecretsStore.getState().setApiKey(normalized.apiKey);
  },
  setModelCache: (cache) => set({ modelCache: cache }),
  clearModelCache: () => set({ modelCache: null }),
  isAIValid: () => {
    const { ai } = get();
    return !!(ai.apiKey && ai.apiBaseUrl && ai.model);
  },
});
