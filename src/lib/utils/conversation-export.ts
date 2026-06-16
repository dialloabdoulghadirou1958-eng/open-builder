import type { Conversation, ProjectSnapshot } from "../../types";

export const CONVERSATION_EXPORT_SCHEMA = "open-builder.conversation";
export const CONVERSATION_EXPORT_VERSION = 1;
const DEFAULT_IMPORTED_TITLE = "__new_app__";
const PREVIEW_MAX_CHARS = 300;

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
    typeof value.createdAt === "number"
  );
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    isStringRecord(value.files) &&
    typeof value.template === "string" &&
    typeof value.isProjectInitialized === "boolean" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function assertConversationExport(value: unknown): asserts value is ConversationExportV1 {
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
  if (
    !Array.isArray(value.snapshots) ||
    !value.snapshots.every((snap) => isSnapshot(snap))
  ) {
    throw new Error("Import file contains invalid snapshots.");
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
