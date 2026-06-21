import JSZip from "jszip";
import { parseSkillMd } from "./parser";
import type { SkillRegistry } from "./registry";
import type { SkillEntry } from "./types";
import { resolveSkillUrl } from "./url-resolver";
import { SKILL_IMPORT_LIMITS, assertSafePath } from "./paths";
import {
  assertSkillArchiveSize,
  assertSkillImportEntryCount,
  createSkillImportBudget,
  readResponseBytesWithLimit,
} from "./import-limits";

export interface ImportResult {
  entry: SkillEntry;
  warnings: string[];
}

function sanitizeId(rawId: string): string {
  const cleaned = rawId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_IMPORT_LIMITS.maxIdChars);
  return cleaned || "imported-skill";
}

function appendIdSuffix(id: string, suffix: string): string {
  return `${id.slice(0, SKILL_IMPORT_LIMITS.maxIdChars - suffix.length)}${suffix}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

interface StagedSkill {
  proposedId: string;
  files: Record<string, string>;
}

function stripCommonPrefix(paths: string[]): {
  prefix: string;
  stripped: string[];
} {
  if (paths.length === 0) return { prefix: "", stripped: [] };
  const segs = paths.map((p) => p.split("/"));
  const first = segs[0];
  let common = 0;
  outer: for (let i = 0; i < first.length - 1; i++) {
    for (const s of segs) {
      if (s.length <= i + 1 || s[i] !== first[i]) break outer;
    }
    common = i + 1;
  }
  const prefix = first.slice(0, common).join("/");
  const stripped = paths.map((p) => {
    const parts = p.split("/").slice(common);
    return parts.join("/");
  });
  return { prefix, stripped };
}

async function stageZip(
  buffer: ArrayBuffer,
  subpath?: string,
): Promise<StagedSkill> {
  assertSkillArchiveSize(buffer.byteLength);
  const zip = await JSZip.loadAsync(buffer);
  const entries: { path: string; file: JSZip.JSZipObject }[] = [];
  zip.forEach((path, file) => {
    if (!file.dir) entries.push({ path, file });
  });
  assertSkillImportEntryCount(entries.length);
  if (entries.length === 0) {
    throw new Error("Zip archive contains no files.");
  }
  const { prefix, stripped } = stripCommonPrefix(entries.map((e) => e.path));

  let working = entries.map((e, i) => ({ ...e, strippedPath: stripped[i] }));
  let idHint = prefix.split("/").pop() || "imported-skill";

  if (subpath) {
    const norm = subpath.replace(/^\/+|\/+$/g, "");
    const target = norm + "/";
    working = working
      .filter((w) => w.strippedPath.startsWith(target))
      .map((w) => ({
        ...w,
        strippedPath: w.strippedPath.slice(target.length),
      }));
    if (working.length === 0) {
      throw new Error(
        `Subpath "${subpath}" did not match any files in the archive.`,
      );
    }
    idHint = norm.split("/").pop() || idHint;
  }

  const files: Record<string, string> = {};
  const budget = createSkillImportBudget();
  for (const entry of working) {
    const relPath = entry.strippedPath;
    if (!relPath) continue;
    assertSafePath(relPath);
    const blob = await entry.file.async("uint8array");
    budget.trackFile(relPath, blob.byteLength);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(blob);
    files[relPath] = text;
  }

  if (!files["SKILL.md"]) {
    throw new Error("Zip is missing SKILL.md at the expected root.");
  }
  return { proposedId: sanitizeId(idHint), files };
}

export async function importFromZip(
  registry: SkillRegistry,
  buffer: ArrayBuffer,
  options?: { subpath?: string },
): Promise<ImportResult> {
  const staged = await stageZip(buffer, options?.subpath);
  return finalizeImport(registry, staged);
}

export async function importFromUrl(
  registry: SkillRegistry,
  url: string,
): Promise<ImportResult> {
  const resolved = resolveSkillUrl(url);
  const res = await fetch(resolved.url, {
    headers: { Accept: "application/vnd.github+json, */*" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch "${resolved.url}": ${res.status} ${res.statusText}`,
    );
  }
  if (resolved.kind === "zip") {
    const bytes = await readResponseBytesWithLimit(
      res,
      SKILL_IMPORT_LIMITS.maxArchiveBytes,
      "Skill archive",
    );
    const buf = toArrayBuffer(bytes);
    return importFromZip(registry, buf, { subpath: resolved.subpath });
  }
  const bytes = await readResponseBytesWithLimit(
    res,
    SKILL_IMPORT_LIMITS.maxSkillMdBytes,
    "SKILL.md",
  );
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const parsed = parseSkillMd(text);
  const proposedId = sanitizeId(parsed.frontmatter.name);
  const staged: StagedSkill = {
    proposedId,
    files: { "SKILL.md": text },
  };
  return finalizeImport(registry, staged);
}

export async function importFromFolder(
  registry: SkillRegistry,
  dirHandle: FileSystemDirectoryHandle,
): Promise<ImportResult> {
  const files: Record<string, string> = {};
  const budget = createSkillImportBudget();
  async function walk(
    handle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    for await (const [name, child] of (
      handle as unknown as {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries()) {
      const relPath = prefix ? `${prefix}/${name}` : name;
      if (child.kind === "directory") {
        await walk(child as FileSystemDirectoryHandle, relPath);
      } else {
        assertSafePath(relPath);
        const file = await (child as FileSystemFileHandle).getFile();
        budget.trackFile(relPath, file.size);
        files[relPath] = await file.text();
      }
    }
  }
  await walk(dirHandle, "");
  if (!files["SKILL.md"]) {
    throw new Error("Selected folder is missing SKILL.md at its root.");
  }
  const proposedId = sanitizeId(dirHandle.name);
  return finalizeImport(registry, { proposedId, files });
}

/** Import from a pre-staged file map. Used by Tauri folder import which reads the source via plugin-fs. */
export async function importFromStaged(
  registry: SkillRegistry,
  proposedId: string,
  files: Record<string, string>,
): Promise<ImportResult> {
  if (!files["SKILL.md"]) {
    throw new Error("Imported folder is missing SKILL.md at its root.");
  }
  const budget = createSkillImportBudget();
  for (const path of Object.keys(files)) {
    assertSafePath(path);
    budget.trackFile(path, new TextEncoder().encode(files[path]).byteLength);
  }
  return finalizeImport(registry, { proposedId: sanitizeId(proposedId), files });
}

async function finalizeImport(
  registry: SkillRegistry,
  staged: StagedSkill,
): Promise<ImportResult> {
  const warnings: string[] = [];
  let id = staged.proposedId;
  const parsed = parseSkillMd(staged.files["SKILL.md"]);
  if (!id) id = sanitizeId(parsed.frontmatter.name);
  const existing = registry.list().find((s) => s.id === id);
  if (existing) {
    if (existing.source === "builtin") {
      id = appendIdSuffix(id, "-imported");
      warnings.push(
        `An installed built-in skill already uses id "${staged.proposedId}". Imported as "${id}".`,
      );
    } else {
      warnings.push(`Replaced existing imported skill "${id}".`);
    }
  }
  await registry.writeSkillDirectory(id, staged.files);
  const entry = await registry.registerSkillFromDir(id, "imported");
  return { entry, warnings };
}
