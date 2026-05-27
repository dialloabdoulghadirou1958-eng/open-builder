import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import type { SkillEntry } from "../lib/skills/types";
import { createLocalforageStorage } from "./utils/localforage-storage";
import { runMigrations, type MigrationStep } from "./utils/migrate";

const SKILLS_STORE_VERSION = 1;
const skillsMigrations: MigrationStep[] = [];

const skillsStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-skills" }),
);

interface SkillsState {
  skills: Record<string, SkillEntry>;
  scriptWarningAcknowledged: boolean;
  _hasHydrated: boolean;

  registerSkill: (entry: SkillEntry) => void;
  unregisterSkill: (id: string) => void;
  setSkillEnabled: (id: string, enabled: boolean) => void;
  acknowledgeScriptWarning: () => void;

  getSkill: (id: string) => SkillEntry | undefined;
  listAll: () => SkillEntry[];
  getEnabledSkills: () => SkillEntry[];
}

export const useSkillsStore = create<SkillsState>()(
  persist(
    (set, get) => ({
      skills: {},
      scriptWarningAcknowledged: false,
      _hasHydrated: false,

      registerSkill: (entry) =>
        set((s) => ({ skills: { ...s.skills, [entry.id]: entry } })),

      unregisterSkill: (id) =>
        set((s) => {
          if (!(id in s.skills)) return s;
          const { [id]: _removed, ...rest } = s.skills;
          return { skills: rest };
        }),

      setSkillEnabled: (id, enabled) =>
        set((s) => {
          const existing = s.skills[id];
          if (!existing) return s;
          return {
            skills: { ...s.skills, [id]: { ...existing, enabled } },
          };
        }),

      acknowledgeScriptWarning: () => set({ scriptWarningAcknowledged: true }),

      getSkill: (id) => get().skills[id],
      listAll: () => Object.values(get().skills),
      getEnabledSkills: () =>
        Object.values(get().skills).filter((s) => s.enabled),
    }),
    {
      name: "open-builder-skills",
      version: SKILLS_STORE_VERSION,
      storage: createJSONStorage(() => skillsStorage),
      partialize: (state) => ({
        skills: state.skills,
        scriptWarningAcknowledged: state.scriptWarningAcknowledged,
      }),
      migrate: (persisted, version) =>
        runMigrations(
          skillsMigrations,
          persisted,
          version,
          SKILLS_STORE_VERSION,
        ),
      onRehydrateStorage: () => () => {
        useSkillsStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
