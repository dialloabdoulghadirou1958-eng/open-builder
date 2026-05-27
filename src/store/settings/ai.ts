import type { StateCreator } from "zustand";
import type { ApiType } from "../../lib/ai/provider";
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

export interface AISlice {
  ai: AISettings;
  setAI: (settings: AISettings) => void;
  isAIValid: () => boolean;
}

export const createAISlice: StateCreator<AISlice, [], [], AISlice> = (
  set,
  get,
) => ({
  ai: aiDefaults,
  setAI: (settings) => {
    const normalized = {
      ...settings,
      apiBaseUrl: settings.apiBaseUrl.replace(/\/+$/, ""),
    };
    set({ ai: normalized });
    // Persist apiKey to the encrypted vault (not localStorage).
    void useSecretsStore.getState().setApiKey(normalized.apiKey);
  },
  isAIValid: () => {
    const { ai } = get();
    return !!(ai.apiKey && ai.apiBaseUrl && ai.model);
  },
});
