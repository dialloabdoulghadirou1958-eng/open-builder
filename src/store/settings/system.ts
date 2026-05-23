import type { StateCreator } from "zustand";

export type Language = "system" | "zh" | "en";
export type Theme = "system" | "light" | "dark";

export interface SystemSettings {
  language: Language;
  theme: Theme;
  reverseProxy: boolean;
  planModeEnabled: boolean;
}

export const systemDefaults: SystemSettings = {
  language: "system",
  theme: "system",
  reverseProxy: false,
  planModeEnabled: false,
};

export interface SystemSlice {
  system: SystemSettings;
  setSystem: (settings: SystemSettings) => void;
  togglePlanMode: () => void;
}

export const createSystemSlice: StateCreator<SystemSlice, [], [], SystemSlice> =
  (set) => ({
    system: systemDefaults,
    setSystem: (settings) => set({ system: settings }),
    togglePlanMode: () =>
      set((state) => ({
        system: {
          ...state.system,
          planModeEnabled: !state.system.planModeEnabled,
        },
      })),
  });
