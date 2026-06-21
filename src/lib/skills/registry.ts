import type { SkillFs } from "./fs";
import { parseSkillMd } from "./parser";
import type { SkillEntry } from "./types";
import { BUILTIN_SKILLS, type BuiltinSkill } from "./builtin";
import { SKILL_IMPORT_LIMITS, assertSafePath } from "./paths";

export interface SkillsStoreApi {
  getSkill(id: string): SkillEntry | undefined;
  listAll(): SkillEntry[];
  registerSkill(entry: SkillEntry): void;
  unregisterSkill(id: string): void;
  setSkillEnabled(id: string, enabled: boolean): void;
}

const REFERENCES_DIR = "references";
const SCRIPTS_DIR = "scripts";

export class SkillRegistry {
  constructor(
    private fs: SkillFs,
    private store: SkillsStoreApi,
  ) {}

  async initialize(): Promise<void> {
    for (const builtin of BUILTIN_SKILLS) {
      await this.installBuiltinIfNeeded(builtin);
    }
    await this.pruneMissingDirs();
  }

  list(): SkillEntry[] {
    return this.store.listAll();
  }

  getEnabled(): SkillEntry[] {
    return this.store.listAll().filter((s) => s.enabled);
  }

  async readSkillContent(id: string): Promise<string> {
    const skill = this.requireSkill(id);
    const raw = await this.fs.readFile(`${skill.id}/SKILL.md`);
    const parsed = parseSkillMd(raw);
    return parsed.body;
  }

  async listReferences(id: string): Promise<string[]> {
    const skill = this.requireSkill(id);
    return this.listFilesIn(`${skill.id}/${REFERENCES_DIR}`);
  }

  async readReference(id: string, refPath: string): Promise<string> {
    const skill = this.requireSkill(id);
    const safe = assertSafePath(refPath);
    return this.fs.readFile(`${skill.id}/${REFERENCES_DIR}/${safe}`);
  }

  async listScripts(id: string): Promise<string[]> {
    const skill = this.requireSkill(id);
    return this.listFilesIn(`${skill.id}/${SCRIPTS_DIR}`);
  }

  async readScript(id: string, scriptPath: string): Promise<string> {
    const skill = this.requireSkill(id);
    const safe = assertSafePath(scriptPath);
    return this.fs.readFile(`${skill.id}/${SCRIPTS_DIR}/${safe}`);
  }

  async deleteSkill(id: string): Promise<void> {
    const skill = this.store.getSkill(id);
    if (!skill) return;
    if (skill.source === "builtin") {
      throw new Error(`Cannot delete built-in skill "${id}"`);
    }
    if (await this.fs.exists(skill.id)) {
      await this.fs.remove(skill.id, { recursive: true });
    }
    this.store.unregisterSkill(id);
  }

  async writeSkillDirectory(
    id: string,
    files: Record<string, string>,
  ): Promise<void> {
    this.assertSafeId(id);
    if (await this.fs.exists(id)) {
      await this.fs.remove(id, { recursive: true });
    }
    await this.fs.mkdir(id, { recursive: true });
    for (const [relPath, content] of Object.entries(files)) {
      const safe = assertSafePath(relPath);
      await this.fs.writeFile(`${id}/${safe}`, content);
    }
  }

  /** Register an entry whose files already exist in the FS (e.g., after import). */
  async registerSkillFromDir(
    id: string,
    source: "builtin" | "imported",
    extras?: { builtinVersion?: string },
  ): Promise<SkillEntry> {
    this.assertSafeId(id);
    const raw = await this.fs.readFile(`${id}/SKILL.md`);
    const parsed = parseSkillMd(raw);
    const existing = this.store.getSkill(id);
    const entry: SkillEntry = {
      id,
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      version: parsed.frontmatter.version,
      allowedTools: parsed.frontmatter["allowed-tools"],
      tags: parsed.frontmatter.tags,
      enabled: existing?.enabled ?? true,
      source,
      installedAt: existing?.installedAt ?? Date.now(),
      builtinVersion: extras?.builtinVersion,
    };
    this.store.registerSkill(entry);
    return entry;
  }

  private requireSkill(id: string): SkillEntry {
    this.assertSafeId(id);
    const skill = this.store.getSkill(id);
    if (!skill) throw new Error(`Skill "${id}" is not registered`);
    this.assertSafeId(skill.id);
    return skill;
  }

  private async listFilesIn(dirPath: string): Promise<string[]> {
    if (!(await this.fs.exists(dirPath))) return [];
    const entries = await this.fs.readDir(dirPath);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  }

  private async installBuiltinIfNeeded(builtin: BuiltinSkill): Promise<void> {
    const existing = this.store.getSkill(builtin.id);
    const versionMismatch =
      !existing ||
      existing.source !== "builtin" ||
      existing.builtinVersion !== builtin.version;
    const missingOnDisk = !(await this.fs.exists(`${builtin.id}/SKILL.md`));
    if (!versionMismatch && !missingOnDisk) return;
    await this.writeSkillDirectory(builtin.id, builtin.files);
    await this.registerSkillFromDir(builtin.id, "builtin", {
      builtinVersion: builtin.version,
    });
  }

  private async pruneMissingDirs(): Promise<void> {
    for (const entry of this.store.listAll()) {
      if (!(await this.fs.exists(`${entry.id}/SKILL.md`))) {
        this.store.unregisterSkill(entry.id);
      }
    }
  }

  private assertSafeId(id: string): void {
    if (
      !id ||
      id.length > SKILL_IMPORT_LIMITS.maxIdChars ||
      !/^[a-zA-Z0-9._-]+$/.test(id)
    ) {
      throw new Error(
        `Unsafe skill id "${id}". Must match [a-zA-Z0-9._-]+ and be <= ${SKILL_IMPORT_LIMITS.maxIdChars} characters.`,
      );
    }
  }
}
