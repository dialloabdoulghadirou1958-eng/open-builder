import type { StateCreator } from "zustand";
import { SERVER_ENGINE } from "./web-search";

export interface AssetSearchSettings {
  engine: "pixabay" | "unsplash" | "disabled" | typeof SERVER_ENGINE;
  pixabayApiKey: string;
  pixabayApiUrl: string;
  unsplashApiKey: string;
  unsplashApiUrl: string;
  backendProvider?: string;
}

export const assetSearchDefaults: AssetSearchSettings = {
  engine: "disabled",
  pixabayApiKey: "",
  pixabayApiUrl: "https://pixabay.com/api",
  unsplashApiKey: "",
  unsplashApiUrl: "https://api.unsplash.com",
};

export interface AssetSearchSlice {
  assetSearch: AssetSearchSettings;
  setAssetSearch: (settings: AssetSearchSettings) => void;
  isAssetSearchConfigured: () => boolean;
}

export const createAssetSearchSlice: StateCreator<
  AssetSearchSlice,
  [],
  [],
  AssetSearchSlice
> = (set, get) => ({
  assetSearch: assetSearchDefaults,
  setAssetSearch: (settings) => set({ assetSearch: settings }),
  isAssetSearchConfigured: () => {
    const { assetSearch } = get();
    if (assetSearch.engine === "disabled") return false;
    if (assetSearch.engine === "pixabay") return !!assetSearch.pixabayApiKey;
    if (assetSearch.engine === "unsplash") return !!assetSearch.unsplashApiKey;
    return false;
  },
});
