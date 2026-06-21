import { SKILL_IMPORT_LIMITS, textBytes } from "./paths";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} bytes`;
}

export function assertSkillArchiveSize(byteLength: number): void {
  if (byteLength > SKILL_IMPORT_LIMITS.maxArchiveBytes) {
    throw new Error(
      `Skill archive exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxArchiveBytes)} limit.`,
    );
  }
}

export function assertSkillImportEntryCount(count: number): void {
  if (count > SKILL_IMPORT_LIMITS.maxArchiveEntries) {
    throw new Error(
      `Skill archive contains too many files (max ${SKILL_IMPORT_LIMITS.maxArchiveEntries}).`,
    );
  }
}

export function createSkillImportBudget(): {
  trackFile: (path: string, byteLength: number) => void;
} {
  let fileCount = 0;
  let totalBytes = 0;

  return {
    trackFile(path: string, byteLength: number): void {
      const perFileLimit =
        path === "SKILL.md"
          ? SKILL_IMPORT_LIMITS.maxSkillMdBytes
          : SKILL_IMPORT_LIMITS.maxFileBytes;
      if (byteLength > perFileLimit) {
        throw new Error(
          `File "${path}" exceeds ${formatBytes(perFileLimit)} limit.`,
        );
      }
      fileCount += 1;
      if (fileCount > SKILL_IMPORT_LIMITS.maxFileCount) {
        throw new Error(
          `Skill import contains too many files (max ${SKILL_IMPORT_LIMITS.maxFileCount}).`,
        );
      }
      totalBytes += byteLength;
      if (totalBytes > SKILL_IMPORT_LIMITS.maxTotalBytes) {
        throw new Error(
          `Skill import exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxTotalBytes)} total size limit.`,
        );
      }
    },
  };
}

export function assertSkillMdSize(raw: string): void {
  const size = textBytes(raw);
  if (size > SKILL_IMPORT_LIMITS.maxSkillMdBytes) {
    throw new Error(
      `SKILL.md exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxSkillMdBytes)} limit.`,
    );
  }
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`${label} exceeds ${formatBytes(maxBytes)} limit.`);
    }
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${label} exceeds ${formatBytes(maxBytes)} limit.`);
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds ${formatBytes(maxBytes)} limit.`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
