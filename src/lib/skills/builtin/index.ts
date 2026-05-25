import reactPatternsSkillMd from "./react-patterns/SKILL.md?raw";
import reactPatternsHelloJs from "./react-patterns/scripts/hello.js?raw";
import debuggingSkillMd from "./debugging/SKILL.md?raw";
import tailwindHelpersSkillMd from "./tailwind-helpers/SKILL.md?raw";
import accessibilitySkillMd from "./accessibility/SKILL.md?raw";
import typescriptPatternsSkillMd from "./typescript-patterns/SKILL.md?raw";

export interface BuiltinSkill {
  id: string;
  version: string;
  files: Record<string, string>;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: "react-patterns",
    version: "1.0.1",
    files: {
      "SKILL.md": reactPatternsSkillMd,
      "scripts/hello.js": reactPatternsHelloJs,
    },
  },
  {
    id: "debugging",
    version: "1.0.0",
    files: {
      "SKILL.md": debuggingSkillMd,
    },
  },
  {
    id: "tailwind-helpers",
    version: "1.0.0",
    files: {
      "SKILL.md": tailwindHelpersSkillMd,
    },
  },
  {
    id: "accessibility",
    version: "1.0.0",
    files: {
      "SKILL.md": accessibilitySkillMd,
    },
  },
  {
    id: "typescript-patterns",
    version: "1.0.0",
    files: {
      "SKILL.md": typescriptPatternsSkillMd,
    },
  },
];
