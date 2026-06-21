import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const MAX_AUDIT_ARGS = 32;
const MAX_AUDIT_ARG_CHARS = 1000;

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

function normalizeAuditArgs(args: string[]): string[] {
  return args.slice(0, MAX_AUDIT_ARGS).map((arg) =>
    arg.length > MAX_AUDIT_ARG_CHARS
      ? `${arg.slice(0, MAX_AUDIT_ARG_CHARS)}...`
      : arg,
  );
}

export const useSecurityAuditStore = create<SecurityAuditState>()(
  persist(
    (set) => ({
      skillScriptExecutions: [],
      recordSkillScriptExecution: (entry) => {
        const auditEntry: SkillScriptAuditEntry = {
          id: crypto.randomUUID(),
          ...entry,
          args: normalizeAuditArgs(entry.args),
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
