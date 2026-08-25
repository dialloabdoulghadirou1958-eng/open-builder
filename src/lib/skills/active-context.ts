import { SKILL_TOOL_NAME_SET } from "./tools";
import type { SkillEntry } from "./types";

export interface ActiveSkill {
  skillId: string;
  skillName: string;
  allowedTools: string[];
  activatedAt: number;
}

export interface SkillActiveContext {
  skills: ActiveSkill[];
  allowedTools: string[];
  restrictTools: boolean;
}

const active = new Map<string, ActiveSkill>();

export const skillActiveContext = {
  get(): SkillActiveContext | null {
    const skills = Array.from(active.values());
    if (skills.length === 0) return null;
    const declared = skills.filter((skill) => skill.allowedTools.length > 0);
    return {
      skills,
      allowedTools: Array.from(
        new Set(declared.flatMap((skill) => skill.allowedTools)),
      ),
      restrictTools: declared.length > 0,
    };
  },
  activate(skill: SkillEntry): void {
    active.set(skill.id, {
      skillId: skill.id,
      skillName: skill.name,
      allowedTools: skill.allowedTools ?? [],
      activatedAt: Date.now(),
    });
  },
  activateMany(skills: readonly SkillEntry[]): void {
    for (const skill of skills) this.activate(skill);
  },
  isActive(skillId: string): boolean {
    return active.has(skillId);
  },
  clear(): void {
    active.clear();
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
