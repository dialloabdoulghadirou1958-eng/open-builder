import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSkillMd } from "./parser";
import type { SkillManifest } from "./types";
import { resolvePublicSkillUrl } from "./manifest";

const publicRoot = new URL("../../../public/skills/", import.meta.url);

function readPublic(path: string): string {
  return readFileSync(new URL(path, publicRoot), "utf8");
}

describe("public skills manifest", () => {
  it("matches every shipped SKILL.md and declared file", () => {
    const manifest = JSON.parse(readPublic("manifest.json")) as SkillManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(new Set(manifest.skills.map((skill) => skill.id)).size).toBe(
      manifest.skills.length,
    );

    for (const skill of manifest.skills) {
      expect(() => readPublic(skill.entry)).not.toThrow();
      for (const file of skill.files) {
        expect(() => readPublic(file)).not.toThrow();
      }
      const parsed = parseSkillMd(readPublic(skill.entry)).frontmatter;
      expect(parsed.name).toBe(skill.name);
      expect(parsed.description).toBe(skill.description);
      expect(parsed.version).toBe(skill.version);
      expect(parsed["allowed-tools"] ?? []).toEqual(skill.allowedTools ?? []);
      expect(parsed.tags ?? []).toEqual(skill.tags ?? []);
    }
  });

  it("resolves public assets under nested Vite base paths", () => {
    expect(
      resolvePublicSkillUrl(
        "react-patterns/SKILL.md",
        "/open-builder/",
        "https://example.com/open-builder/index.html",
      ),
    ).toBe("https://example.com/open-builder/skills/react-patterns/SKILL.md");
  });
});
