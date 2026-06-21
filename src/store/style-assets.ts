import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import type { StyleAsset } from "../types";
import { createLocalforageStorage } from "./utils/localforage-storage";
import { runMigrations, type MigrationStep } from "./utils/migrate";
import {
  normalizeStyleAssetTags,
  normalizeStyleAssetInstructions,
  normalizeStyleAssetTokens,
  sanitizeStyleAssetName,
} from "../lib/utils/style-assets";

const STYLE_ASSET_STORE_VERSION = 1;
const styleAssetMigrations: MigrationStep[] = [];

const styleAssetStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-style-assets" }),
);

type StyleAssetUpdate = Partial<
  Pick<
    StyleAsset,
    "name" | "description" | "instructions" | "tokens" | "tags" | "enabled"
  >
>;

interface StyleAssetState {
  assets: Record<string, StyleAsset>;
  _hasHydrated: boolean;

  addAsset: (asset: StyleAsset) => string;
  updateAsset: (id: string, patch: StyleAssetUpdate) => boolean;
  deleteAsset: (id: string) => boolean;
  setAssetEnabled: (id: string, enabled: boolean) => boolean;
  getAsset: (id: string) => StyleAsset | undefined;
  listAssets: () => StyleAsset[];
  getEnabledAssets: () => StyleAsset[];
}

export const useStyleAssetStore = create<StyleAssetState>()(
  persist(
    (set, get) => ({
      assets: {},
      _hasHydrated: false,

      addAsset: (asset) => {
        set((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
        return asset.id;
      },

      updateAsset: (id, patch) => {
        const existing = get().assets[id];
        if (!existing) return false;
        const next: StyleAsset = {
          ...existing,
          ...patch,
          name:
            patch.name === undefined
              ? existing.name
              : sanitizeStyleAssetName(patch.name),
          description:
            patch.description === undefined
              ? existing.description
              : patch.description.trim() || undefined,
          instructions:
            patch.instructions === undefined
              ? existing.instructions
              : normalizeStyleAssetInstructions(patch.instructions),
          tokens:
            patch.tokens === undefined
              ? existing.tokens
              : normalizeStyleAssetTokens(patch.tokens),
          tags:
            patch.tags === undefined
              ? existing.tags
              : normalizeStyleAssetTags(patch.tags),
          updatedAt: Date.now(),
        };
        set((s) => ({ assets: { ...s.assets, [id]: next } }));
        return true;
      },

      deleteAsset: (id) => {
        if (!get().assets[id]) return false;
        set((s) => {
          const { [id]: _deleted, ...rest } = s.assets;
          return { assets: rest };
        });
        return true;
      },

      setAssetEnabled: (id, enabled) =>
        get().updateAsset(id, { enabled }),

      getAsset: (id) => get().assets[id],
      listAssets: () =>
        Object.values(get().assets).sort((a, b) => b.updatedAt - a.updatedAt),
      getEnabledAssets: () =>
        get()
          .listAssets()
          .filter((asset) => asset.enabled),
    }),
    {
      name: "open-builder-style-assets",
      version: STYLE_ASSET_STORE_VERSION,
      storage: createJSONStorage(() => styleAssetStorage),
      partialize: (state) => ({
        assets: state.assets,
      }),
      migrate: (persisted, version) =>
        runMigrations(
          styleAssetMigrations,
          persisted,
          version,
          STYLE_ASSET_STORE_VERSION,
        ),
      onRehydrateStorage: () => () => {
        useStyleAssetStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
