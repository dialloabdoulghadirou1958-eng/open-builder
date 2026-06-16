import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface SkillScriptAuditEntry {
  id: string;
  skillId: string;
  skillName: string;
  scriptPath: string;
  args: string[];
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  status: "success" | "failed";
}

interface SecurityAuditState {
  skillScriptExecutions: SkillScriptAuditEntry[];
  recordSkillScriptExecution: (
    entry: Omit<SkillScriptAuditEntry, "id">,
  ) => void;
  clearSkillScriptExecutions: () => void;
}

export const useSecurityAuditStore = create<SecurityAuditState>()(
  persist(
    (set) => ({
      skillScriptExecutions: [],
      recordSkillScriptExecution: (entry) => {
        const auditEntry: SkillScriptAuditEntry = {
          id: crypto.randomUUID(),
          ...entry,
        };
        set((state) => ({
          skillScriptExecutions: [
            ...state.skillScriptExecutions.slice(-99),
            auditEntry,
          ],
        }));
      },
      clearSkillScriptExecutions: () => {
        set({ skillScriptExecutions: [] });
      },
    }),
    {
      name: "open-builder-security-audit",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        skillScriptExecutions: state.skillScriptExecutions,
      }),
    },
  ),
);
