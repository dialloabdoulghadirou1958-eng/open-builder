export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const ALLOWED_RELPATH_RE = /^[a-zA-Z0-9._/-]+$/;

export function assertSafePath(path: string): string {
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Unsafe path: "${path}"`);
  }
  if (!ALLOWED_RELPATH_RE.test(path)) {
    throw new Error(
      `Unsafe path "${path}". Only alphanumerics, '.', '_', '-', '/' allowed.`,
    );
  }
  return path;
}

export function extension(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i + 1).toLowerCase();
}
