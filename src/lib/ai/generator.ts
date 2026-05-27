// ============================================================================
//  generator.ts
//  AI Tool Call engine — drives an in-memory web-app build through the AI SDK.
//  Files live as Record<path, content>; no Node dependencies, runs in browser.
// ============================================================================

import { streamText, generateText } from "ai";
import type { ToolSet } from "ai";
import { getProviderModel, buildProviderOptions } from "./provider";
import type { ApiType } from "./provider";
import { messagesToModelMessages } from "./messages";
import { BUILTIN_TOOLS } from "./tools-schema";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt";
import { dispatchFsTool } from "../tools/fs-tools";
import { formatAskUserAnswers } from "../utils/tool-result";
import {
  ALWAYS_ALLOWED_TOOL_NAMES,
  skillActiveContext,
} from "../skills/active-context";
import type {
  Message,
  ToolCall,
  ContentPart,
  ProjectFiles,
  FileChange,
  GenerateResult,
  GeneratorOptions,
  GeneratorEvents,
  AskUserQuestion,
} from "./generator-types";

// Re-export everything so callers can keep importing types from this module.
export type {
  AskUserQuestion,
  AskUserAnswerItem,
  AskUserAnswers,
  PlanDecision,
  ProjectFiles,
  ContentPart,
  Message,
  ToolCall,
  ToolDefinition,
  FileChange,
  GenerateResult,
  GeneratorOptions,
  GeneratorEvents,
} from "./generator-types";

export const PLAN_APPROVED_PREFIX = "Plan approved";
export const PLAN_REJECTED_PREFIX = "Plan rejected";

export class WebAppGenerator {
  // ── internal state ──
  private files: ProjectFiles;
  private messages: Message[];
  private events: GeneratorEvents;
  private ctrl: AbortController | null = null;

  // ── config (read-only) ──
  private readonly apiType: ApiType;
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private readonly useStream: boolean;
  private tools: ToolSet;
  private readonly customToolSet: ToolSet;
  private readonly customToolHandler?: GeneratorOptions["customToolHandler"];
  private readonly useThinking: boolean;
  private readonly thinkingBudget: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly providerToolNames: Set<string>;
  private readonly askUserQuestion?: GeneratorOptions["askUserQuestion"];
  private readonly requestPlanApproval?: GeneratorOptions["requestPlanApproval"];
  private readonly onPlanApproved?: GeneratorOptions["onPlanApproved"];
  private readonly dispatchSubagent?: GeneratorOptions["dispatchSubagent"];
  private systemPromptSuffix: string = "";

  constructor(options: GeneratorOptions, events: GeneratorEvents = {}) {
    this.apiType = options.apiType ?? "openai-compatible";
    this.apiBaseUrl = options.apiBaseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxIterations = options.maxIterations ?? 30;
    this.useStream = options.stream ?? true;
    this.customToolSet = options.customTools ?? {};
    this.tools = options.tools
      ? options.tools
      : { ...BUILTIN_TOOLS, ...this.customToolSet };
    this.customToolHandler = options.customToolHandler;
    this.useThinking = options.thinking ?? true;
    this.thinkingBudget = options.thinkingBudget ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
    this.providerToolNames = new Set(options.providerToolNames ?? []);
    this.askUserQuestion = options.askUserQuestion;
    this.requestPlanApproval = options.requestPlanApproval;
    this.onPlanApproved = options.onPlanApproved;
    this.dispatchSubagent = options.dispatchSubagent;

    this.files = { ...(options.initialFiles ?? {}) };
    this.messages = [];
    this.events = events;
  }

  // ═══════════════════════════ public API ═════════════════════════════════

  getFiles(): ProjectFiles {
    return { ...this.files };
  }

  setFiles(files: ProjectFiles): void {
    this.files = { ...files };
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  resetMessages(): void {
    this.messages = [];
  }

  syncMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  setSystemPromptSuffix(suffix: string): void {
    this.systemPromptSuffix = suffix;
  }

  /** Replace the tool set used on subsequent iterations.
   *  Used to switch between plan-mode (no write tools) and full tool set after plan approval.
   *  The provided set is used as-is — the caller is responsible for including any builtins it wants. */
  setTools(tools: ToolSet): void {
    this.tools = tools;
  }

  getCustomToolSet(): ToolSet {
    return this.customToolSet;
  }

  abort(): void {
    this.ctrl?.abort();
    this.ctrl = null;
  }

  /** Retry the loop without adding a new user message (user message is already in history). */
  async retry(): Promise<GenerateResult> {
    return this._runGenerateLoop();
  }

  async generate(
    userMessage: string,
    attachments?: Array<{
      type: string;
      name: string;
      content: string;
      size: number;
    }>,
  ): Promise<GenerateResult> {
    if (attachments && attachments.length > 0) {
      const parts: ContentPart[] = [];
      if (userMessage) parts.push({ type: "text", text: userMessage });
      for (const att of attachments) {
        if (att.type === "image") {
          parts.push({ type: "image_url", image_url: { url: att.content } });
        } else {
          parts.push({
            type: "text",
            text: `[File: ${att.name} | ${att.size}]\n${att.content}`,
          });
        }
      }
      this.messages.push({ role: "user", content: parts });
    } else {
      this.messages.push({ role: "user", content: userMessage });
    }

    return this._runGenerateLoop();
  }

  // ═══════════════════════════ internals ══════════════════════════════════

  private async _runGenerateLoop(): Promise<GenerateResult> {
    const systemContent = this.buildSystemContent();
    let fullText = "";
    let aborted = false;
    let maxReached = false;

    try {
      for (let iter = 0; iter < this.maxIterations; iter++) {
        const isLastIter = iter === this.maxIterations - 1;
        const requestMessages: Message[] = [
          { role: "system", content: systemContent },
          ...(isLastIter
            ? [
                {
                  role: "system" as const,
                  content:
                    `Tool call iteration budget exhausted (limit: ${this.maxIterations}). ` +
                    `This is your final iteration — do not call any more tools. ` +
                    `Summarize what has been accomplished, what is still pending, and stop so the user can resume in a follow-up message.`,
                },
              ]
            : []),
          ...this.messages,
        ];

        const assistantMsg = await this.requestWithRetry(requestMessages);

        this.messages.push(assistantMsg);
        if (assistantMsg.content) {
          fullText += assistantMsg.content;
        }

        if (!assistantMsg.tool_calls?.length) {
          break;
        }

        // Split dispatch_subagent calls out — they run in parallel after the
        // regular sequential calls finish. Read-only subagents share file
        // snapshots, so parallel execution is safe.
        const regularCalls: ToolCall[] = [];
        const dispatchCalls: ToolCall[] = [];
        for (const tc of assistantMsg.tool_calls) {
          if (tc.function.name === "dispatch_subagent") {
            dispatchCalls.push(tc);
          } else {
            regularCalls.push(tc);
          }
        }

        for (const toolCall of regularCalls) {
          if (this.providerToolNames.has(toolCall.function.name)) {
            continue;
          }

          if (
            toolCall.function.name === "compact_context" &&
            this.events.onCompact
          ) {
            const compacted = await this.events.onCompact();
            if (compacted) {
              this.messages = compacted;
              this.messages.push(assistantMsg);
            }
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: compacted
                ? "OK — context compressed successfully."
                : "Context compression skipped (not enough messages).",
            });
            this.events.onToolResult?.(
              toolCall.function.name,
              {},
              this.messages[this.messages.length - 1].content as string,
              toolCall.id,
            );
            continue;
          }

          const { result, changes } = await this.executeTool(toolCall);

          this.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });

          if (changes.length > 0) {
            this.events.onFileChange?.(this.getFiles(), changes);
          }
        }

        if (dispatchCalls.length > 0) {
          const MAX_PARALLEL = 3;
          const accepted = dispatchCalls.slice(0, MAX_PARALLEL);
          const rejected = dispatchCalls.slice(MAX_PARALLEL);

          const results = await Promise.all(
            accepted.map((tc) => this.executeTool(tc)),
          );

          for (let i = 0; i < accepted.length; i++) {
            this.messages.push({
              role: "tool",
              tool_call_id: accepted[i].id,
              content: results[i].result,
            });
          }

          for (const tc of rejected) {
            const msg = `Too many parallel subagent dispatches in one turn (limit: ${MAX_PARALLEL}). Reissue this call in the next turn.`;
            this.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: msg,
            });
            this.events.onToolResult?.(tc.function.name, {}, msg, tc.id);
          }
        }

        if (iter === this.maxIterations - 1) {
          maxReached = true;
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        aborted = true;
      } else {
        this.events.onError?.(err);
        throw err;
      }
    }

    const result: GenerateResult = {
      files: this.getFiles(),
      messages: this.getMessages(),
      text: fullText,
      aborted,
      maxIterationsReached: maxReached,
    };

    this.events.onComplete?.(result);
    return result;
  }

  private isRetryableError(err: any): boolean {
    if (err.name === "AbortError") return false;
    if (err.status) return err.status === 429 || err.status >= 500;
    // No HTTP status -> likely a network error, retryable
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this.ctrl?.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private async requestWithRetry(messages: Message[]): Promise<Message> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestAI(messages);
      } catch (err: any) {
        if (!this.isRetryableError(err) || attempt >= this.maxRetries)
          throw err;
        this.events.onRetry?.(attempt + 1, this.maxRetries, err);
        const delay =
          this.retryDelay * Math.pow(2, attempt) + Math.random() * 500;
        await this.sleep(delay);
      }
    }
  }

  private buildSystemContent(): string {
    const paths = Object.keys(this.files).sort();
    const listing =
      paths.length > 0
        ? "\n\nCurrent project files:\n" + paths.map((p) => `- ${p}`).join("\n")
        : "\n\nThe project is empty — no files yet.";
    return this.systemPrompt + listing + this.systemPromptSuffix;
  }

  private async requestAI(messages: Message[]): Promise<Message> {
    this.ctrl = new AbortController();

    const coreMessages = messagesToModelMessages(messages, this.apiType);
    const model = getProviderModel({
      apiType: this.apiType,
      apiBaseUrl: this.apiBaseUrl,
      apiKey: this.apiKey,
      model: this.model,
    });

    const providerOptions = this.useThinking
      ? buildProviderOptions(this.apiType, this.thinkingBudget)
      : undefined;

    if (this.useStream) {
      return this.requestStreamAI(model, coreMessages, providerOptions);
    } else {
      return this.requestGenerateAI(model, coreMessages, providerOptions);
    }
  }

  private async requestStreamAI(
    model: ReturnType<typeof getProviderModel>,
    coreMessages: ReturnType<typeof messagesToModelMessages>,
    providerOptions?: ReturnType<typeof buildProviderOptions>,
  ): Promise<Message> {
    const result = streamText({
      model,
      messages: coreMessages,
      tools: this.tools,
      maxRetries: 0,
      abortSignal: this.ctrl!.signal,
      providerOptions: providerOptions as any,
    });

    let contentAccum = "";
    let thinkingAccum = "";
    const toolCallsAccum: ToolCall[] = [];

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          contentAccum += part.text;
          this.events.onText?.(part.text);
          break;

        case "reasoning-delta":
          thinkingAccum += part.text;
          this.events.onThinking?.(part.text);
          break;

        case "tool-input-start":
          if (!this.providerToolNames.has(part.toolName)) {
            this.events.onToolCall?.(part.toolName, part.id);
          }
          break;

        case "tool-call":
          if (!this.providerToolNames.has(part.toolName)) {
            toolCallsAccum.push({
              id: part.toolCallId,
              type: "function",
              function: {
                name: part.toolName,
                arguments: JSON.stringify(part.input),
              },
            });
          }
          break;
      }
    }

    return {
      role: "assistant",
      content: contentAccum || null,
      tool_calls: toolCallsAccum.length > 0 ? toolCallsAccum : undefined,
      thinking: thinkingAccum || undefined,
    };
  }

  private async requestGenerateAI(
    model: ReturnType<typeof getProviderModel>,
    coreMessages: ReturnType<typeof messagesToModelMessages>,
    providerOptions?: ReturnType<typeof buildProviderOptions>,
  ): Promise<Message> {
    const result = await generateText({
      model,
      messages: coreMessages,
      tools: this.tools,
      maxRetries: 0,
      abortSignal: this.ctrl!.signal,
      providerOptions: providerOptions as any,
    });

    if (result.text) {
      this.events.onText?.(result.text);
    }

    const reasoning = (result as any).reasoning;
    if (reasoning) {
      this.events.onThinking?.(reasoning);
    }

    const toolCalls: ToolCall[] = (result.toolCalls || []).map((tc) => ({
      id: tc.toolCallId,
      type: "function",
      function: {
        name: tc.toolName,
        arguments: JSON.stringify(tc.input),
      },
    }));

    for (const tc of toolCalls) {
      this.events.onToolCall?.(tc.function.name, tc.id);
    }

    return {
      role: "assistant",
      content: result.text || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: reasoning || undefined,
    };
  }

  private async executeTool(
    toolCall: ToolCall,
  ): Promise<{ result: string; changes: FileChange[] }> {
    const name = toolCall.function.name;

    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      const errMsg = `Error: failed to parse arguments for "${name}"`;
      this.events.onToolResult?.(name, null, errMsg, toolCall.id);
      return { result: errMsg, changes: [] };
    }

    const activeCtx = skillActiveContext.get();
    if (
      activeCtx &&
      !ALWAYS_ALLOWED_TOOL_NAMES.has(name) &&
      !activeCtx.allowedTools.includes(name)
    ) {
      const errMsg =
        `Tool "${name}" is not in the active skill "${activeCtx.skillName}"'s ` +
        `allowed-tools. Available now: ${activeCtx.allowedTools.join(", ")}. ` +
        `Work within these tools, or call read_skill on a different skill, or wait for the next user message to clear the restriction.`;
      this.events.onToolResult?.(name, args, errMsg, toolCall.id);
      return { result: errMsg, changes: [] };
    }

    // File-system tools go through the shared dispatcher.
    const fsOutcome = dispatchFsTool(name, args, this.files);
    if (fsOutcome) {
      if (fsOutcome.newFiles) {
        this.files = fsOutcome.newFiles;
      }
      if (fsOutcome.templateChange) {
        this.events.onTemplateChange?.(
          fsOutcome.templateChange.template,
          this.getFiles(),
        );
      }
      if (fsOutcome.dependenciesChanged) {
        this.events.onDependenciesChange?.(this.getFiles());
      }
      this.events.onToolResult?.(name, args, fsOutcome.result, toolCall.id);
      return { result: fsOutcome.result, changes: fsOutcome.changes };
    }

    let result: string;

    switch (name) {
      case "ask_user_question": {
        if (!this.askUserQuestion) {
          result =
            "ask_user_question is not available in this session — fall back to making a reasonable assumption and proceed.";
          break;
        }
        try {
          const answers = await this.askUserQuestion(
            toolCall.id,
            args.questions as AskUserQuestion[],
          );
          result = formatAskUserAnswers(answers);
        } catch (err: any) {
          if (err?.name === "AbortError") throw err;
          result = `User question was cancelled: ${err?.message ?? "unknown"}`;
        }
        break;
      }

      case "dispatch_subagent": {
        if (!this.dispatchSubagent) {
          result =
            "dispatch_subagent is not available in this session — handle the task yourself.";
          break;
        }
        const subagentName =
          typeof args?.subagent === "string" ? args.subagent : "";
        const subagentTask =
          typeof args?.task === "string" ? args.task : "";
        if (!subagentName || !subagentTask) {
          result =
            'Error: dispatch_subagent requires both "subagent" (name) and "task" (string) arguments.';
          break;
        }
        try {
          const dispatched = await this.dispatchSubagent(
            subagentName,
            subagentTask,
            this.files,
            this.ctrl!.signal,
            toolCall.id,
          );
          result = dispatched.text;
          // A fullWrite subagent returns its inner file tree; reconcile by
          // diffing against the parent's current state and emitting an
          // onFileChange event with the resolved changes.
          if (dispatched.files) {
            const beforeFiles = this.files;
            const afterFiles = dispatched.files;
            const changes: FileChange[] = [];
            for (const path of Object.keys(afterFiles)) {
              if (!(path in beforeFiles)) {
                changes.push({ path, action: "created" });
              } else if (beforeFiles[path] !== afterFiles[path]) {
                changes.push({ path, action: "modified" });
              }
            }
            for (const path of Object.keys(beforeFiles)) {
              if (!(path in afterFiles)) {
                changes.push({ path, action: "deleted" });
              }
            }
            this.files = { ...afterFiles };
            if (changes.length > 0) {
              this.events.onFileChange?.(this.getFiles(), changes);
            }
          }
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") throw err;
          const message =
            (err as { message?: string })?.message ?? "Unknown error";
          result = `Error dispatching subagent "${subagentName}": ${message}`;
        }
        break;
      }

      case "exit_plan_mode": {
        if (!this.requestPlanApproval) {
          result =
            "exit_plan_mode is not available in this session. Just present the plan in your reply.";
          break;
        }
        try {
          const decision = await this.requestPlanApproval(
            toolCall.id,
            args.plan as string,
          );
          if (decision.approved) {
            const newTools = this.onPlanApproved?.();
            if (newTools) {
              this.tools = newTools;
            }
            result = `${PLAN_APPROVED_PREFIX} by the user. Plan mode is now exited — proceed to implement the plan using the available write tools.`;
          } else {
            result = decision.feedback
              ? `${PLAN_REJECTED_PREFIX} by the user.\nUser feedback: ${decision.feedback}\nRevise the plan based on this feedback and call exit_plan_mode again.`
              : `${PLAN_REJECTED_PREFIX} by the user. Ask what to change and revise before calling exit_plan_mode again.`;
          }
        } catch (err: any) {
          if (err?.name === "AbortError") throw err;
          result = `Plan approval was cancelled: ${err?.message ?? "unknown"}`;
        }
        break;
      }

      default:
        if (this.customToolHandler) {
          try {
            result = await this.customToolHandler(name, args);
          } catch (err: any) {
            result = `Error in custom tool "${name}": ${err.message}`;
          }
        } else {
          result = `Error: unknown tool "${name}"`;
        }
    }

    this.events.onToolResult?.(name, args, result, toolCall.id);
    return { result, changes: [] };
  }
}
