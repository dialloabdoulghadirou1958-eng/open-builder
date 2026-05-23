// ============================================================================
//  web-app-generator.ts
//  AI Tool Call 引擎 —— 通过 AI SDK 驱动，在内存文件系统中生成 Web App
//  所有文件以 Record<path, content> 形式存储，无任何 Node.js 依赖，可在浏览器运行
// ============================================================================

import { SANDBOX_TEMPLATES } from "@codesandbox/sandpack-react";
import { streamText, generateText } from "ai";
import type { ToolSet } from "ai";
import { getProviderModel, buildProviderOptions } from "./ai-provider";
import type { ApiType } from "./ai-provider";
import { messagesToModelMessages } from "./ai-messages";
import { BUILTIN_TOOLS } from "./ai-tools";
import type {
  AskUserQuestion,
  AskUserAnswers,
  PlanDecision,
} from "../store/interactive";

export type {
  AskUserQuestion,
  AskUserAnswerItem,
  AskUserAnswers,
  PlanDecision,
} from "../store/interactive";

// ═══════════════════════════════ 类型定义 ═══════════════════════════════════

/** Result string prefixes for exit_plan_mode, exposed so the UI can detect
 *  the decision without string-matching against full prose. */
export const PLAN_APPROVED_PREFIX = "Plan approved";
export const PLAN_REJECTED_PREFIX = "Plan rejected";

/** 项目文件：路径 → 内容 */
export type ProjectFiles = Record<string, string>;

/** OpenAI 多模态内容块 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** 内部消息格式 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** 模型思考过程（extended thinking） */
  thinking?: string;
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** 工具定义（OpenAI function calling 格式，保留用于向后兼容） */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
}

/** 文件变更记录 */
export interface FileChange {
  path: string;
  action: "created" | "modified" | "deleted";
}

/** generate() 的最终返回值 */
export interface GenerateResult {
  files: ProjectFiles;
  messages: Message[];
  text: string;
  aborted: boolean;
  maxIterationsReached: boolean;
}

/** 构造选项 */
export interface GeneratorOptions {
  /** API 类型 */
  apiType?: ApiType;
  /** API 基础地址 */
  apiBaseUrl: string;
  /** API 密钥 */
  apiKey: string;
  /** 模型 ID */
  model: string;
  /** 自定义系统提示词（提供了合理默认值） */
  systemPrompt?: string;
  /** 初始项目文件 */
  initialFiles?: ProjectFiles;
  /** 工具调用最大循环轮次（默认 30） */
  maxIterations?: number;
  /** 是否启用流式输出（默认 true） */
  stream?: boolean;
  /** 额外的自定义工具（AI SDK ToolSet 格式） */
  customTools?: ToolSet;
  /** 完整工具集 — 若提供则直接使用，跳过与 BUILTIN_TOOLS 的合并。
   *  调用方需自行决定包含哪些内置工具（用于 plan 模式过滤等场景）。 */
  tools?: ToolSet;
  /** 自定义工具的执行回调（内置工具之外的分发到这里） */
  customToolHandler?: (name: string, args: unknown) => string | Promise<string>;
  /** 是否启用 thinking（默认 true） */
  thinking?: boolean;
  /** thinking 的 budget_tokens（默认 10000） */
  thinkingBudget?: number;
  /** Max auto-retry attempts for failed API requests (default 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 1000) */
  retryDelay?: number;
  /** Names of provider-managed tools (executed server-side, not locally) */
  providerToolNames?: string[];
  /** Handler for the built-in `ask_user_question` tool. Receives the tool call id and the
   *  AI-supplied questions, returns the user's answers. Rejecting with AbortError aborts the run. */
  askUserQuestion?: (
    toolCallId: string,
    questions: AskUserQuestion[],
  ) => Promise<AskUserAnswers>;
  /** Handler for the built-in `exit_plan_mode` tool. Receives the tool call id and the plan
   *  markdown, returns the user's approval decision. Rejecting with AbortError aborts the run. */
  requestPlanApproval?: (
    toolCallId: string,
    plan: string,
  ) => Promise<PlanDecision>;
  /** Called once the user approves a plan via exit_plan_mode. If a new ToolSet is returned,
   *  the generator swaps to it on the next iteration (so write tools become available). */
  onPlanApproved?: () => ToolSet | void;
}

/** 事件回调 */
export interface GeneratorEvents {
  /** AI 输出文本片段（流式时逐 chunk 触发） */
  onText?: (delta: string) => void;
  /** AI 思考过程片段（流式时逐 chunk 触发） */
  onThinking?: (delta: string) => void;
  /** AI 开始调用某个工具 */
  onToolCall?: (name: string, toolCallId: string) => void;
  /** 工具执行完毕 */
  onToolResult?: (name: string, args: unknown, result: string) => void;
  /** 项目文件发生变更 */
  onFileChange?: (files: ProjectFiles, changes: FileChange[]) => void;
  /** 项目模板变更（init_project 触发） */
  onTemplateChange?: (template: string, files: ProjectFiles) => void;
  /** 项目依赖变更（manage_dependencies 触发，需要重启 Sandpack） */
  onDependenciesChange?: (files: ProjectFiles) => void;
  /** 整个 generate 流程结束 */
  onComplete?: (result: GenerateResult) => void;
  /** 出错 */
  onError?: (error: Error) => void;
  /** API request is being retried after a failure */
  onRetry?: (attempt: number, maxAttempts: number, error: Error) => void;
  /** 上下文压缩，返回压缩后的消息列表 */
  onCompact?: () => Promise<Message[] | null>;
}

// ═══════════════════════════════ 默认常量 ═══════════════════════════════════

const DEFAULT_SYSTEM_PROMPT = `<role>
You are an expert web developer specializing in building complete, high-performance, and functional web applications. You utilize professional file systems and tools to deliver production-ready, secure, and accessible code.
</role>

<workflow>
1. Constraint Validation: Before any planning or execution, you must explicitly state your understanding of the user's requirements and constraints. You must confirm that all technical requirements are clear before proceeding.
2. Architecture Summary: Provide a high-level overview of the design patterns, file structure, and technology choices. You must include a brief rationale for choosing specific libraries or frameworks when multiple options exist.
3. Task Execution Planning: Generate a GFM task list (e.g., * [ ] Step) to outline your strategy. Update this list in real-time. Immediately after completing a subtask, provide an updated version of the list with the completed item checked off ([x]). Your final response for any task must include the completed list with all items checked.
4. Implementation: Follow the standards defined in the rules section, utilizing tools for file management and code quality.
5. Verification: Execute mandatory runtime checks to ensure code health.
</workflow>

<rules>
- Code Integrity: Produce only complete, runnable code. The use of placeholders, "// TODO" comments, or truncated snippets (e.g., "...") is strictly forbidden.
- Modern Standards: Use modern ES6+ JavaScript syntax and CSS variables for all styling to ensure maintainability. Use semantic HTML5 elements to improve SEO and structural clarity.
- UI/UX Design: Explicitly follow mobile-first, responsive design principles as a default standard for all interfaces.
- Tailwind CSS usage: If your project requires complex CSS styles, please use Tailwind CSS to develop your project by injecting \`<script src="https://cdn.tailwindcss.com"></script>\` into \`index.html\`.
- Chart usage: If a webpage contains a large amount of data, you can use \`Chart.js\` to generate charts by injecting \`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\` into \`index.html\`, thereby improving the page's expressiveness and interactivity.
- Accessibility: All generated UI components must comply with WCAG accessibility standards, including proper ARIA roles and keyboard navigation.
- Security Protocols: Implement strict security measures, including input sanitization and specific preventions against Cross-Site Scripting (XSS).
- Documentation: Use JSDoc or standardized commenting for all complex logic, functions, and custom modules.
- Performance Optimization: Proactively suggest and implement performance enhancements such as code splitting, lazy loading of assets, and efficient resource management.
- Enhance visual appeal: Using appropriate images during page development can effectively enhance the visual appeal of a website.
- Dependencies: Strictly forbid the use of deprecated libraries, APIs, or unmaintained third-party packages.
- Project Organization: Maintain professional directory structures and logical file hierarchies for all projects to ensure scalability.
- Markdown Formatting: When outputting content in responses, use proper Markdown syntax: images as \`![alt](url)\`, links as \`[title](url)\`, and utilize tables, blockquotes, and other Markdown features for better readability.
</rules>

<tools>
- Read-Before-Write: You must always read existing files using the \`read_files\` tool before attempting modifications to maintain full context.
- Incremental Edits: Prioritize the \`patch_file\` tool for making targeted changes. Avoid overwriting entire files when a patch is sufficient.
- Efficiency: Batch multiple file creation or modification operations into single responses using parallel tool calls to optimize execution.
- Mandatory Verification: Before all development tasks are completed, you should execute \`get_console_logs\`. 
    - Critical Errors: You are responsible for identifying and fixing all runtime errors discovered. 
    - Warnings: Evaluate warnings for potential impact on performance or stability and resolve them where necessary.
- Task Finalization: You must not declare a task finished until all identified errors are resolved and the GFM task list is entirely checked off.
- Image Assets: When building UI components, use the \`image_search\` tool to find appropriate real images for hero sections, banners, marketing pages, product showcases, galleries, blog posts, and user profiles. For simple icons, buttons, or decorative elements, use icon libraries or CSS instead of searching for images.
- NPM Packages: When you need third-party libraries for specific functionality, use \`search_npm_packages\` to discover suitable packages. Use \`get_npm_package_detail\` to verify TypeScript support, check dependencies, and review documentation. Prefer packages with high quality scores, active maintenance, and TypeScript support.
</tools>`;

/** 内置工具定义 */
// 内置工具已迁移到 ai-tools.ts，使用 Zod schema 定义

// ════════════════════════════ WebAppGenerator 类 ════════════════════════════

export class WebAppGenerator {
  // ── 内部状态 ──
  private files: ProjectFiles;
  private messages: Message[];
  private events: GeneratorEvents;
  private ctrl: AbortController | null = null;

  // ── 配置（只读） ──
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

    this.files = { ...(options.initialFiles ?? {}) };
    this.messages = [];
    this.events = events;
  }

  // ═══════════════════════════ 公开 API ═══════════════════════════════════

  /** 获取当前项目文件快照 */
  getFiles(): ProjectFiles {
    return { ...this.files };
  }

  /** 替换整个项目文件 */
  setFiles(files: ProjectFiles): void {
    this.files = { ...files };
  }

  /** 获取完整对话消息历史 */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** 清空对话历史（文件保留） */
  resetMessages(): void {
    this.messages = [];
  }

  /** 从外部状态同步对话历史（用于保持与 Store 的一致性） */
  syncMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  /** Set a dynamic suffix to append to the system prompt (e.g., memory context) */
  setSystemPromptSuffix(suffix: string): void {
    this.systemPromptSuffix = suffix;
  }

  /** Replace the tool set used on subsequent iterations.
   *  Used to switch between plan-mode (no write tools) and full tool set after plan approval.
   *  The provided set is used as-is — the caller is responsible for including any builtins it wants. */
  setTools(tools: ToolSet): void {
    this.tools = tools;
  }

  /** Return the custom (non-builtin) tools registered at construction time.
   *  Used by callers that rebuild the active tool set on each run (e.g. plan-mode toggling). */
  getCustomToolSet(): ToolSet {
    return this.customToolSet;
  }

  /** 中止正在进行的 generate 请求 */
  abort(): void {
    this.ctrl?.abort();
    this.ctrl = null;
  }

  /**
   * 重试：不添加新的用户消息，直接重新运行生成循环
   * 用于错误后重试，此时用户消息已在历史中
   */
  async retry(): Promise<GenerateResult> {
    return this._runGenerateLoop();
  }

  /**
   * 核心方法：发送用户消息，驱动 AI 通过 Tool Call 循环生成/修改项目文件
   */
  async generate(
    userMessage: string,
    attachments?: Array<{
      type: string;
      name: string;
      content: string;
      size: number;
    }>,
  ): Promise<GenerateResult> {
    // Build user message: multi-part if attachments present
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

  private async _runGenerateLoop(): Promise<GenerateResult> {
    const systemContent = this.buildSystemContent();
    let fullText = "";
    let aborted = false;
    let maxReached = false;

    try {
      for (let iter = 0; iter < this.maxIterations; iter++) {
        const requestMessages: Message[] = [
          { role: "system", content: systemContent },
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

        for (const toolCall of assistantMsg.tool_calls) {
          // Skip provider-managed tools (executed server-side, e.g. built-in search)
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
              // Add back the assistant message with tool_calls and the tool result
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

  // ══════════════════════════ 内部方法 ══════════════════════════════════════

  /** Check if an error is retryable */
  private isRetryableError(err: any): boolean {
    if (err.name === "AbortError") return false;
    if (err.status) return err.status === 429 || err.status >= 500;
    // No HTTP status → likely a network error, retryable
    return true;
  }

  /** Sleep that can be interrupted by abort signal */
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

  /** Wrap API request with retry logic */
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

  /** 通过 AI SDK 发起请求 */
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

  /** 流式请求 — 使用 AI SDK streamText() */
  private async requestStreamAI(
    model: ReturnType<typeof getProviderModel>,
    coreMessages: ReturnType<typeof messagesToModelMessages>,
    providerOptions?: ReturnType<typeof buildProviderOptions>,
  ): Promise<Message> {
    const result = streamText({
      model,
      messages: coreMessages,
      tools: this.tools,
      maxRetries: 0, // retry 由 requestWithRetry 处理
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
          // Skip UI notification for provider-managed tools
          if (!this.providerToolNames.has(part.toolName)) {
            this.events.onToolCall?.(part.toolName, part.id);
          }
          break;

        case "tool-call":
          // Only track non-provider tool calls for local execution
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

  /** 非流式请求 — 使用 AI SDK generateText() */
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
      this.events.onToolResult?.(name, null, errMsg);
      return { result: errMsg, changes: [] };
    }

    const changes: FileChange[] = [];
    let result: string;

    switch (name) {
      case "init_project":
        result = this.toolInitProject(args.template, changes);
        break;

      case "manage_dependencies":
        result = this.toolManageDependencies(args.package_json, changes);
        break;

      case "list_files":
        result = this.toolListFiles();
        break;

      // case "read_file":
      //   result = this.toolReadFile(args.path);
      //   break;

      case "read_files":
        result = this.toolReadFiles(args.paths);
        break;

      case "write_file":
        result = this.toolWriteFile(args.path, args.content, changes);
        break;

      case "patch_file": {
        const patches = Array.isArray(args.patches)
          ? args.patches
          : [args.patches];
        result = this.toolPatchFile(args.path, patches, changes);
        break;
      }

      case "delete_file":
        result = this.toolDeleteFile(args.path, changes);
        break;

      case "search_in_files":
        result = this.toolSearchInFiles(args.pattern);
        break;

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
          result = this.formatAskUserAnswers(answers);
        } catch (err: any) {
          if (err?.name === "AbortError") throw err;
          result = `User question was cancelled: ${err?.message ?? "unknown"}`;
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

    this.events.onToolResult?.(name, args, result);
    return { result, changes };
  }

  private toolInitProject(template: string, changes: FileChange[]): string {
    const tmpl = SANDBOX_TEMPLATES[template as keyof typeof SANDBOX_TEMPLATES];
    if (!tmpl) {
      return `Error: unknown template "${template}". Use one of: ${Object.keys(SANDBOX_TEMPLATES).join(", ")}`;
    }
    const newFiles: ProjectFiles = {};
    for (const [path, file] of Object.entries(tmpl.files)) {
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const code =
        typeof file === "string" ? file : (file as { code: string }).code;
      newFiles[normalizedPath] = code;
      changes.push({ path: normalizedPath, action: "created" });
    }
    this.files = newFiles;
    this.events.onTemplateChange?.(template, this.getFiles());
    return `OK — initialized project with template "${template}" (${Object.keys(newFiles).length} files)`;
  }

  private toolManageDependencies(
    packageJson: string,
    changes: FileChange[],
  ): string {
    try {
      JSON.parse(packageJson);
    } catch {
      return "Error: invalid JSON in package_json";
    }
    const pkgPath =
      Object.keys(this.files).find((p) => p.endsWith("package.json")) ||
      "package.json";
    const action: FileChange["action"] =
      pkgPath in this.files ? "modified" : "created";
    this.files[pkgPath] = packageJson;
    changes.push({ path: pkgPath, action });
    this.events.onDependenciesChange?.(this.getFiles());
    return `OK — ${action} ${pkgPath}, dependencies updated. Sandpack will restart.`;
  }

  private formatAskUserAnswers(answers: AskUserAnswers): string {
    if (!answers.answers?.length) {
      return "(no answers returned)";
    }
    return answers.answers
      .map((a, idx) => {
        const picks = a.selected.length
          ? a.selected.join(" | ")
          : "(no selection)";
        return `Q${idx + 1} [${a.header}] ${a.question}\n→ ${picks}`;
      })
      .join("\n\n");
  }

  private toolListFiles(): string {
    const paths = Object.keys(this.files).sort();
    if (paths.length === 0) return "(empty project — no files)";
    return paths.join("\n");
  }

  // private toolReadFile(path: string): string {
  //   if (!(path in this.files)) {
  //     return `Error: file not found — "${path}"`;
  //   }
  //   return this.files[path];
  // }

  private toolReadFiles(paths: string[]): string {
    if (!Array.isArray(paths) || paths.length === 0) {
      return "Error: no paths provided";
    }
    return paths
      .map((path) => {
        if (!(path in this.files)) {
          return `=== ${path} ===\nError: file not found`;
        }
        return `=== ${path} ===\n${this.files[path]}`;
      })
      .join("\n\n");
  }

  private toolWriteFile(
    path: string,
    content: string,
    changes: FileChange[],
  ): string {
    const action: FileChange["action"] =
      path in this.files ? "modified" : "created";
    this.files[path] = content;
    changes.push({ path, action });
    return `OK — ${action}: ${path} (${content.length} chars)`;
  }

  private toolPatchFile(
    path: string,
    patches: Array<{ search: string; replace: string }>,
    changes: FileChange[],
  ): string {
    if (!(path in this.files)) {
      return `Error: file not found — "${path}"`;
    }

    let content = this.files[path];
    const log: string[] = [];

    for (let i = 0; i < patches.length; i++) {
      const { search, replace } = patches[i];
      const idx = content.indexOf(search);

      if (idx >= 0) {
        content =
          content.slice(0, idx) + replace + content.slice(idx + search.length);
        log.push(`patch #${i + 1}: ✓ applied`);
      } else {
        const preview = search.length > 60 ? search.slice(0, 60) + "…" : search;
        log.push(`patch #${i + 1}: ✗ not found — "${preview}"`);
      }
    }

    this.files[path] = content;
    changes.push({ path, action: "modified" });
    return log.join("\n");
  }

  private toolSearchInFiles(pattern: string): string {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "g");
    } catch {
      return `Error: invalid regex pattern — "${pattern}"`;
    }
    const results: string[] = [];
    for (const [path, content] of Object.entries(this.files)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${path}:${i + 1}: ${lines[i].trim()}`);
        }
        regex.lastIndex = 0;
      }
    }
    return results.length > 0 ? results.join("\n") : "(no matches found)";
  }

  private toolDeleteFile(path: string, changes: FileChange[]): string {
    if (!(path in this.files)) {
      return `Error: file not found — "${path}"`;
    }
    delete this.files[path];
    changes.push({ path, action: "deleted" });
    return `OK — deleted: ${path}`;
  }
}
