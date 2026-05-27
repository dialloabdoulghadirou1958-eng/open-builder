import type { Message as _Message, ProjectFiles as _ProjectFiles } from "../lib/ai/generator-types";

export type {
  ProjectFiles,
  ContentPart,
  Message,
  ToolCall,
  ToolDefinition,
  FileChange,
  GenerateResult,
  GeneratorOptions,
  GeneratorEvents,
} from "../lib/ai/generator-types";

export type { AISettings, WebSearchSettings, AssetSearchSettings } from "../store/settings";
export type { OpenAIClientConfig } from "../lib/ai/client";
export type { ApiType } from "../lib/ai/provider";

// ─── Chat UI types ────────────────────────────────────────────────────────────

/** Attachment in the input pipeline (before sending) */
export interface Attachment {
  type: "file" | "image";
  name: string;
  /** DataURL for images/PDFs, plain text for text files */
  content: string;
  /** Original file size in bytes */
  size: number;
}

export interface TextBlock {
  type: "text";
  content: string;
  id: string;
}

export interface ImageBlock {
  type: "image";
  url: string;
  id: string;
}

export interface FileBlock {
  type: "file";
  name: string;
  content: string;
  /** Original file size in bytes */
  size: number;
  id: string;
}

export interface ThinkingBlock {
  type: "thinking";
  content: string;
  id: string;
}

export interface ToolBlock {
  type: "tool";
  toolName: string;
  title: string;
  path: string;
  paths?: string[];
  result: string;
  /** Tool call id used by the AI SDK — needed to correlate with pending UI prompts. */
  toolCallId: string;
  /** Raw parsed arguments the AI passed to the tool. Used by interactive tools
   *  (ask_user_question, exit_plan_mode) that render full args in the UI. */
  rawArgs?: Record<string, unknown>;
  id: string;
}

export type Block = TextBlock | ImageBlock | FileBlock | ThinkingBlock | ToolBlock;

export interface MergedMessage {
  role: "user" | "assistant";
  blocks: Block[];
  id: string;
  /** True when this assistant message was synthesized to report a local error
   *  (network failure, aborted retry, etc.). Drives the retry affordance in the
   *  UI without relying on string-prefix sniffing. */
  isError?: boolean;
}

// ─── Snapshot types ─────────────────────────────────────────────────────────

/** Incremental project snapshot (git-like).
 *  Snapshots come in two flavours:
 *    - "patch" (default): records adds/patches/deletes relative to the prior snapshot
 *    - "checkpoint": records the full file tree, anchoring future replays so we
 *      don't have to walk the entire chain. Inserted automatically every
 *      CHECKPOINT_INTERVAL patches.
 */
export interface ProjectSnapshot {
  id: string;
  /** The conversation this snapshot belongs to */
  conversationId: string;
  /** Associated MergedMessage ID (e.g. "assistant-0") */
  messageId: string;
  /** File path → unified diff patch (modified files only) */
  patches: Record<string, string>;
  /** Newly added files: path → full content */
  addedFiles: Record<string, string>;
  /** Paths of deleted files */
  deletedFiles: string[];
  createdAt: number;
  /** Snapshot type — older records lack this field and are implicitly "patch". */
  kind?: "patch" | "checkpoint";
  /** Full file tree at this point. Only present on checkpoint snapshots. */
  fullFiles?: _ProjectFiles;
}

// ─── Memory types ───────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  content: string;
  category: "preference" | "personal_info" | "instruction" | "fact" | "project";
  createdAt: number;
  updatedAt: number;
}

export interface MemoryOperation {
  action: "add" | "update" | "delete";
  /** Required for update and delete */
  id?: string;
  /** Required for add and update */
  content?: string;
  /** Required for add, optional for update */
  category?: MemoryItem["category"];
}

// ─── Conversation types ──────────────────────────────────────────────────────

/** Compressed context: summary text + the message index where compression starts */
export interface CompressedContext {
  summary: string;
  fromIndex: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: _Message[];
  files: _ProjectFiles;
  template: string;
  isProjectInitialized: boolean;
  compressedContext?: CompressedContext;
  pinned?: boolean;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}
