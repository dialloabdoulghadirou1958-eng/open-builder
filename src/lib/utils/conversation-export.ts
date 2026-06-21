import type { Conversation, ProjectSnapshot } from "../../types";
import { normalizeCompressedSummary } from "./compress-context";

export const CONVERSATION_EXPORT_SCHEMA = "open-builder.conversation";
export const CONVERSATION_EXPORT_VERSION = 1;
export const MAX_CONVERSATION_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_MESSAGES = 5000;
export const MAX_IMPORT_PROJECT_FILES = 3000;
export const MAX_IMPORT_SNAPSHOTS = 1000;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_IMPORTED_TITLE = "__new_app__";
const PREVIEW_MAX_CHARS = 300;
const ERROR_KINDS = new Set([
  "auth",
  "network",
  "model",
  "tool",
  "context_length",
  "aborted",
  "runtime_check",
  "unknown",
]);

function estimateTextBytes(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

export function formatConversationImportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export interface GenerationLogToolEntry {
  messageIndex: number;
  toolCallId: string;
  name: string;
  argsPreview: string;
  resultPreview?: string;
}

export interface ConversationGenerationLog {
  generatedAt: number;
  conversationId: string;
  title: string;
  messages: {
    total: number;
    user: number;
    assistant: number;
    tool: number;
    errorAssistant: number;
  };
  tools: {
    totalCalls: number;
    resultCount: number;
    failedResultCount: number;
    pendingCallIds: string[];
    byName: Record<string, number>;
    timeline: GenerationLogToolEntry[];
  };
  project: {
    template: string;
    initialized: boolean;
    fileCount: number;
    fileBytes: number;
    snapshotCount: number;
    checkpointCount: number;
    patchCount: number;
    hasCompressedContext: boolean;
  };
}

export interface ConversationExportV1 {
  schema: typeof CONVERSATION_EXPORT_SCHEMA;
  version: typeof CONVERSATION_EXPORT_VERSION;
  exportedAt: number;
  conversation: Conversation;
  snapshots: ProjectSnapshot[];
  generationLog?: ConversationGenerationLog;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCompressedContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    typeof value.fromIndex === "number" &&
    Number.isFinite(value.fromIndex) &&
    value.fromIndex >= 0
  );
}

function isContentPart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "image_url") {
    return (
      isRecord(value.image_url) &&
      typeof value.image_url.url === "string" &&
      (value.image_url.url.startsWith("data:image/") ||
        /^https?:\/\//.test(value.image_url.url))
    );
  }
  return false;
}

function isMessage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    value.role !== "system" &&
    value.role !== "user" &&
    value.role !== "assistant" &&
    value.role !== "tool"
  ) {
    return false;
  }
  const contentOk =
    value.content === null ||
    typeof value.content === "string" ||
    (Array.isArray(value.content) && value.content.every(isContentPart));
  if (!contentOk) return false;

  if (value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls)) return false;
    const toolCallsOk = value.tool_calls.every(
      (call) =>
        isRecord(call) &&
        call.type === "function" &&
        typeof call.id === "string" &&
        isRecord(call.function) &&
        typeof call.function.name === "string" &&
        typeof call.function.arguments === "string",
    );
    if (!toolCallsOk) return false;
  }

  return (
    (value.tool_call_id === undefined ||
      typeof value.tool_call_id === "string") &&
    (value.thinking === undefined || typeof value.thinking === "string") &&
    (value.isError === undefined || typeof value.isError === "boolean") &&
    (value.errorKind === undefined ||
      (typeof value.errorKind === "string" && ERROR_KINDS.has(value.errorKind))) &&
    (value.errorRetryable === undefined ||
      typeof value.errorRetryable === "boolean") &&
    (value.errorStatus === undefined || typeof value.errorStatus === "number")
  );
}

function assertRecordWithinLimits(
  record: Record<string, string>,
  label: string,
): void {
  for (const [path, content] of Object.entries(record)) {
    if (!path || path.includes("\0")) {
      throw new Error(`${label} contains an invalid file path.`);
    }
    const bytes = estimateTextBytes(content);
    if (bytes > MAX_IMPORT_FILE_BYTES) {
      throw new Error(
        `${label} contains a file over ${formatConversationImportBytes(MAX_IMPORT_FILE_BYTES)}: ${path}`,
      );
    }
  }
}

function isSnapshot(value: unknown): value is ProjectSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.messageId === "string" &&
    isStringRecord(value.patches) &&
    isStringRecord(value.addedFiles) &&
    Array.isArray(value.deletedFiles) &&
    value.deletedFiles.every((p) => typeof p === "string") &&
    isFiniteTimestamp(value.createdAt) &&
    (value.kind === undefined ||
      value.kind === "patch" ||
      value.kind === "checkpoint") &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.fullFiles === undefined || isStringRecord(value.fullFiles))
  );
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    isStringRecord(value.files) &&
    typeof value.template === "string" &&
    typeof value.isProjectInitialized === "boolean" &&
    isFiniteTimestamp(value.createdAt) &&
    isFiniteTimestamp(value.updatedAt) &&
    (value.pinned === undefined || typeof value.pinned === "boolean") &&
    (value.archived === undefined || typeof value.archived === "boolean") &&
    (value.compressedContext === undefined ||
      isCompressedContext(value.compressedContext))
  );
}

function assertConversationExport(
  value: unknown,
): asserts value is ConversationExportV1 {
  if (!isRecord(value)) {
    throw new Error("Import file must contain a JSON object.");
  }
  if (
    value.schema !== CONVERSATION_EXPORT_SCHEMA ||
    value.version !== CONVERSATION_EXPORT_VERSION
  ) {
    throw new Error("Unsupported Open Builder conversation export format.");
  }
  if (!isConversation(value.conversation)) {
    throw new Error("Import file contains an invalid conversation.");
  }
  if (value.conversation.messages.length > MAX_IMPORT_MESSAGES) {
    throw new Error(
      `Import file contains too many messages (max ${MAX_IMPORT_MESSAGES}).`,
    );
  }
  if (Object.keys(value.conversation.files).length > MAX_IMPORT_PROJECT_FILES) {
    throw new Error(
      `Import file contains too many project files (max ${MAX_IMPORT_PROJECT_FILES}).`,
    );
  }
  assertRecordWithinLimits(value.conversation.files, "Import file");
  if (
    !Array.isArray(value.snapshots) ||
    !value.snapshots.every((snap) => isSnapshot(snap))
  ) {
    throw new Error("Import file contains invalid snapshots.");
  }
  if (value.snapshots.length > MAX_IMPORT_SNAPSHOTS) {
    throw new Error(
      `Import file contains too many snapshots (max ${MAX_IMPORT_SNAPSHOTS}).`,
    );
  }
  for (const snapshot of value.snapshots) {
    if (snapshot.conversationId !== value.conversation.id) {
      throw new Error("Import file contains snapshots for another conversation.");
    }
    assertRecordWithinLimits(snapshot.patches, "Import snapshot");
    assertRecordWithinLimits(snapshot.addedFiles, "Import snapshot");
    if (snapshot.fullFiles) {
      assertRecordWithinLimits(snapshot.fullFiles, "Import snapshot");
    }
  }
}

export function createConversationExport(
  conversation: Conversation,
  snapshots: ProjectSnapshot[],
  exportedAt = Date.now(),
): ConversationExportV1 {
  return {
    schema: CONVERSATION_EXPORT_SCHEMA,
    version: CONVERSATION_EXPORT_VERSION,
    exportedAt,
    conversation,
    snapshots,
    generationLog: buildConversationGenerationLog(
      conversation,
      snapshots,
      exportedAt,
    ),
  };
}

export function parseConversationExport(text: string): ConversationExportV1 {
  const bytes = estimateTextBytes(text);
  if (bytes > MAX_CONVERSATION_IMPORT_BYTES) {
    throw new Error(
      `Import file is too large. Maximum size is ${formatConversationImportBytes(MAX_CONVERSATION_IMPORT_BYTES)}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Import file is not valid JSON.");
  }
  assertConversationExport(parsed);
  return parsed;
}

export function cloneImportedConversation(
  conversation: Conversation,
  id: string = crypto.randomUUID(),
  now = Date.now(),
): Conversation {
  return {
    ...conversation,
    id,
    title: conversation.title || DEFAULT_IMPORTED_TITLE,
    messages: [...conversation.messages],
    files: { ...conversation.files },
    ...(conversation.compressedContext
      ? {
          compressedContext: {
            fromIndex: Math.max(
              0,
              Math.floor(conversation.compressedContext.fromIndex),
            ),
            summary: normalizeCompressedSummary(
              conversation.compressedContext.summary,
            ),
          },
        }
      : { compressedContext: undefined }),
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneImportedSnapshots(
  snapshots: ProjectSnapshot[],
  conversationId: string,
  now = Date.now(),
): ProjectSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    id: crypto.randomUUID(),
    conversationId,
    patches: { ...snapshot.patches },
    addedFiles: { ...snapshot.addedFiles },
    deletedFiles: [...snapshot.deletedFiles],
    createdAt: now,
    ...(snapshot.fullFiles ? { fullFiles: { ...snapshot.fullFiles } } : {}),
  }));
}

export function exportFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "open-builder-session"}.open-builder.json`;
}

export function buildConversationGenerationLog(
  conversation: Conversation,
  snapshots: ProjectSnapshot[],
  generatedAt = Date.now(),
): ConversationGenerationLog {
  const toolResults = new Map<string, string>();
  const failedResultIds = new Set<string>();

  conversation.messages.forEach((message) => {
    if (message.role !== "tool" || !message.tool_call_id) return;
    const content = stringifyContent(message.content);
    toolResults.set(message.tool_call_id, preview(content));
    if (looksFailedToolResult(content)) {
      failedResultIds.add(message.tool_call_id);
    }
  });

  const timeline: GenerationLogToolEntry[] = [];
  const byName: Record<string, number> = {};
  const pendingCallIds: string[] = [];

  conversation.messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant" || !message.tool_calls) return;
    for (const call of message.tool_calls) {
      byName[call.function.name] = (byName[call.function.name] ?? 0) + 1;
      const resultPreview = toolResults.get(call.id);
      if (!resultPreview) pendingCallIds.push(call.id);
      timeline.push({
        messageIndex,
        toolCallId: call.id,
        name: call.function.name,
        argsPreview: preview(call.function.arguments || "{}"),
        ...(resultPreview ? { resultPreview } : {}),
      });
    }
  });

  const messageCounts = conversation.messages.reduce(
    (counts, message) => {
      counts.total++;
      if (message.role === "user") counts.user++;
      if (message.role === "assistant") {
        counts.assistant++;
        if (message.isError) counts.errorAssistant++;
      }
      if (message.role === "tool") counts.tool++;
      return counts;
    },
    { total: 0, user: 0, assistant: 0, tool: 0, errorAssistant: 0 },
  );

  return {
    generatedAt,
    conversationId: conversation.id,
    title: conversation.title,
    messages: messageCounts,
    tools: {
      totalCalls: timeline.length,
      resultCount: toolResults.size,
      failedResultCount: failedResultIds.size,
      pendingCallIds,
      byName,
      timeline,
    },
    project: {
      template: conversation.template,
      initialized: conversation.isProjectInitialized,
      fileCount: Object.keys(conversation.files).length,
      fileBytes: estimateStringRecordBytes(conversation.files),
      snapshotCount: snapshots.length,
      checkpointCount: snapshots.filter(
        (snapshot) => snapshot.kind === "checkpoint",
      ).length,
      patchCount: snapshots.filter((snapshot) => snapshot.kind !== "checkpoint")
        .length,
      hasCompressedContext: Boolean(conversation.compressedContext),
    },
  };
}

function estimateStringRecordBytes(record: Record<string, string>): number {
  return Object.values(record).reduce((sum, value) => sum + value.length, 0);
}

function stringifyContent(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function preview(text: string): string {
  return text.length > PREVIEW_MAX_CHARS
    ? `${text.slice(0, PREVIEW_MAX_CHARS)}...`
    : text;
}

function looksFailedToolResult(content: string): boolean {
  if (/^Error\b|^Error:/i.test(content.trim())) return true;
  try {
    const parsed = JSON.parse(content);
    return parsed?.ok === false || parsed?.success === false;
  } catch {
    return false;
  }
}
