import type {
  ExecutionMode,
  RuntimePlatform,
  ToolSource,
} from "../ai/tools-schema";

const STORAGE_KEY = "open-builder-permission-activity";
const MAX_ENTRIES = 200;
const MAX_TEXT_CHARS = 240;

export interface PermissionActivityEntry {
  id: string;
  at: number;
  tool: string;
  source: ToolSource | "unknown";
  mode: ExecutionMode;
  platform: RuntimePlatform;
  decision: "allowed" | "denied" | "requested";
  target?: string;
  reason?: string;
}

function safeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]*/gi, "$1[REDACTED]")
    .slice(0, MAX_TEXT_CHARS);
}

function safeTarget(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return safeText(value);
  }
}

export function getPermissionActivity(): PermissionActivityEntry[] {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.getItem !== "function"
  ) {
    return [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function recordPermissionActivity(
  input: Omit<PermissionActivityEntry, "id" | "at">,
): void {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.setItem !== "function"
  ) {
    return;
  }
  const entry: PermissionActivityEntry = {
    ...input,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    at: Date.now(),
    target: safeTarget(input.target),
    reason: safeText(input.reason),
  };
  const entries = [...getPermissionActivity(), entry].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Permission logging is best-effort and must never block a tool decision.
  }
}

export function clearPermissionActivity(): void {
  if (
    typeof localStorage !== "undefined" &&
    typeof localStorage.removeItem === "function"
  ) {
    localStorage.removeItem(STORAGE_KEY);
  }
}
