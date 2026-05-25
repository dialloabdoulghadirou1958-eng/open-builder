import { SKILL_TOOL_NAME_SET } from "./tools";

export interface SkillActiveContext {
  skillId: string;
  skillName: string;
  allowedTools: string[];
  activatedAt: number;
}

let current: SkillActiveContext | null = null;

export const skillActiveContext = {
  get(): SkillActiveContext | null {
    return current;
  },
  activate(ctx: SkillActiveContext): void {
    current = ctx;
  },
  clear(): void {
    current = null;
  },
};

/** Tools that bypass active-skill allowed-tools filtering. Flow / infrastructure tools. */
export const ALWAYS_ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...SKILL_TOOL_NAME_SET,
  "ask_user_question",
  "exit_plan_mode",
  "compact_context",
  "dispatch_subagent",
]);
