import { z } from "zod";
import { load as yamlLoad, YAMLException } from "js-yaml";

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(512),
  version: z.string().optional().default("1.0.0"),
  author: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMd(raw: string): ParsedSkill {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    throw new Error(
      "SKILL.md must begin with a YAML frontmatter block delimited by '---'",
    );
  }
  const [, fmRaw, body] = m;
  let fmObj: unknown;
  try {
    fmObj = yamlLoad(fmRaw);
  } catch (err) {
    const msg = err instanceof YAMLException ? err.message : String(err);
    throw new Error(`Failed to parse SKILL.md frontmatter: ${msg}`);
  }
  if (!fmObj || typeof fmObj !== "object" || Array.isArray(fmObj)) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping.");
  }
  const frontmatter = SkillFrontmatterSchema.parse(fmObj);
  return { frontmatter, body: body.replace(/^\r?\n/, "") };
}
