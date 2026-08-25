import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { importFromStaged, importFromZip } from "./importer";
import { SkillRegistry, type SkillsStoreApi } from "./registry";
import type { DirEntry, SkillFs } from "./fs";
import { SKILL_IMPORT_LIMITS } from "./paths";
import type { SkillEntry } from "./types";

class MemorySkillFs implements SkillFs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`File not found: ${path}`);
    return value;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    const parts = path.split("/");
    parts.pop();
    for (let i = 1; i <= parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join("/"));
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const prefix = path ? `${path}/` : "";
    const names = new Map<string, DirEntry>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const [name, ...tail] = rest.split("/");
      names.set(name, {
        name,
        isFile: tail.length === 0,
        isDirectory: tail.length > 0,
      });
    }
    return Array.from(names.values());
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async remove(path: string): Promise<void> {
    for (const key of Array.from(this.files.keys())) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.files.delete(key);
      }
    }
    for (const key of Array.from(this.dirs.keys())) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.dirs.delete(key);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return (
      this.files.has(path) ||
      this.dirs.has(path) ||
      Array.from(this.files.keys()).some((key) => key.startsWith(`${path}/`))
    );
  }
}

function createRegistry(): {
  fs: MemorySkillFs;
  registry: SkillRegistry;
  store: SkillsStoreApi;
} {
  const fs = new MemorySkillFs();
  const entries = new Map<string, SkillEntry>();
  const store: SkillsStoreApi = {
    getSkill: (id) => entries.get(id),
    listAll: () => Array.from(entries.values()),
    registerSkill: (entry) => {
      entries.set(entry.id, entry);
    },
    unregisterSkill: (id) => {
      entries.delete(id);
    },
    setSkillAutoEnabled: (id, autoEnabled) => {
      const existing = entries.get(id);
      if (existing) entries.set(id, { ...existing, autoEnabled });
    },
  };
  return { fs, registry: new SkillRegistry(fs, store), store };
}

function skillMd(overrides: string[] = []): string {
  return [
    "---",
    "name: Demo Skill",
    "description: Demo description",
    "version:  1.0.0  ",
    "allowed-tools:",
    "  - read_file",
    "  - read_file",
    "tags:",
    "  - react",
    "  - react",
    ...overrides,
    "---",
    "",
    "Use this skill carefully.",
  ].join("\n");
}

describe("skill importer limits", () => {
  it("rejects oversized zip archives before parsing", async () => {
    const { registry } = createRegistry();

    await expect(
      importFromZip(
        registry,
        new ArrayBuffer(SKILL_IMPORT_LIMITS.maxArchiveBytes + 1),
      ),
    ).rejects.toThrow(/archive exceeds/i);
  });

  it("rejects imports with too many staged files", async () => {
    const { registry } = createRegistry();
    const files: Record<string, string> = { "SKILL.md": skillMd() };
    for (let i = 0; i < SKILL_IMPORT_LIMITS.maxFileCount; i++) {
      files[`references/ref-${i}.md`] = "ref";
    }

    await expect(importFromStaged(registry, "demo", files)).rejects.toThrow(
      /too many files/i,
    );
  });

  it("rejects oversized SKILL.md files", async () => {
    const { registry } = createRegistry();

    await expect(
      importFromStaged(registry, "demo", {
        "SKILL.md": "x".repeat(SKILL_IMPORT_LIMITS.maxSkillMdBytes + 1),
      }),
    ).rejects.toThrow(/SKILL\.md|File "SKILL\.md"/);
  });

  it("normalizes bounded frontmatter before persistence", async () => {
    const { registry, store } = createRegistry();

    const result = await importFromStaged(registry, "demo", {
      "SKILL.md": skillMd(),
    });

    expect(result.entry.version).toBe("1.0.0");
    expect(result.entry.allowedTools).toEqual(["read_file"]);
    expect(result.entry.tags).toEqual(["react"]);
    expect(store.getSkill("demo")).toEqual(result.entry);
  });

  it("rejects malformed allowed tool names from zip imports", async () => {
    const { registry } = createRegistry();
    const zip = new JSZip();
    zip.file(
      "demo/SKILL.md",
      [
        "---",
        "name: Demo Skill",
        "description: Demo description",
        "allowed-tools:",
        "  - bad tool",
        "---",
        "",
        "Body",
      ].join("\n"),
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });

    await expect(importFromZip(registry, buffer)).rejects.toThrow(
      /allowed-tools/i,
    );
  });

  it("rejects unsafe registered skill ids before reading from disk", async () => {
    const { registry } = createRegistry();

    await expect(registry.readSkillContent("../bad")).rejects.toThrow(
      /Unsafe skill id/,
    );
  });
});
