export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  allowedTools?: string[];
  tags?: string[];
  enabled: boolean;
  source: "builtin" | "imported";
  installedAt: number;
  builtinVersion?: string;
}
