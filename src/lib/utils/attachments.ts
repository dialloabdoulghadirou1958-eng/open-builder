import type {
  Attachment,
  AttachmentConstraints,
  AttachmentValidationResult,
} from "../../types";

export const DEFAULT_ATTACHMENT_CONSTRAINTS: AttachmentConstraints = {
  maxCount: 8,
  maxImageBytes: 8 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
};

const ACCEPTED_FILE_MIME_PREFIXES = ["text/"];
const ACCEPTED_FILE_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/xhtml+xml",
  "application/x-yaml",
  "application/sql",
  "application/graphql",
  "application/ld+json",
  "application/x-sh",
  "application/x-httpd-php",
  "application/typescript",
  "application/pdf",
]);
const ACCEPTED_EXTENSIONS = new Set([
  "txt",
  "md",
  "mdx",
  "json",
  "xml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "yaml",
  "yml",
  "sql",
  "graphql",
  "gql",
  "sh",
  "php",
  "css",
  "scss",
  "html",
  "pdf",
]);

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isAcceptedFileMime(mime: string, name = ""): boolean {
  if (ACCEPTED_FILE_MIME_EXACT.has(mime)) return true;
  if (ACCEPTED_FILE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return true;
  }
  return !mime && ACCEPTED_EXTENSIONS.has(extensionOf(name));
}

export function validateAttachmentFile(
  file: File,
  existing: readonly Attachment[],
  constraints = DEFAULT_ATTACHMENT_CONSTRAINTS,
): AttachmentValidationResult {
  const nextCount = existing.length + 1;
  if (nextCount > constraints.maxCount) {
    return {
      ok: false,
      reason: `You can attach up to ${constraints.maxCount} files.`,
    };
  }

  const nextTotal = existing.reduce((sum, item) => sum + item.size, 0) + file.size;
  if (nextTotal > constraints.maxTotalBytes) {
    return {
      ok: false,
      reason: `Attachments can total up to ${formatAttachmentBytes(constraints.maxTotalBytes)}.`,
    };
  }

  if (isImageMime(file.type)) {
    if (file.size > constraints.maxImageBytes) {
      return {
        ok: false,
        reason: `Images can be up to ${formatAttachmentBytes(constraints.maxImageBytes)} each.`,
      };
    }
    return { ok: true };
  }

  if (!isAcceptedFileMime(file.type, file.name)) {
    return {
      ok: false,
      reason: `Unsupported file type: ${file.name || file.type || "unknown"}.`,
    };
  }

  if (file.size > constraints.maxFileBytes) {
    return {
      ok: false,
      reason: `Files can be up to ${formatAttachmentBytes(constraints.maxFileBytes)} each.`,
    };
  }

  return { ok: true };
}
