import type { StateCreator } from "zustand";
import type {
  ServerModel,
  SearchProvider,
  AssetProvider,
} from "../../types/api";

export interface ServerServiceSettings {
  selectedModel: string;
  webSearchEnabled: boolean;
  webSearchProviderId: string;
  assetSearchEnabled: boolean;
  assetSearchProviderId: string;
}

export const serverServiceDefaults: ServerServiceSettings = {
  selectedModel: "",
  webSearchEnabled: true,
  webSearchProviderId: "",
  assetSearchEnabled: true,
  assetSearchProviderId: "",
};

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

export interface ServerServiceSlice {
  serverService: ServerServiceSettings;
  modelCache: ModelCache | null;
  serverServiceCache: ServerServiceCache | null;
  setServerService: (patch: Partial<ServerServiceSettings>) => void;
  setModelCache: (cache: ModelCache) => void;
  clearModelCache: () => void;
  setServerServiceCache: (cache: ServerServiceCache | null) => void;
  patchServerServiceCache: (patch: Partial<ServerServiceCache>) => void;
}

export const createServerServiceSlice: StateCreator<
  ServerServiceSlice,
  [],
  [],
  ServerServiceSlice
> = (set) => ({
  serverService: serverServiceDefaults,
  modelCache: null,
  serverServiceCache: null,
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
});
