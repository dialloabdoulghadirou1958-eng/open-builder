import { useRef, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ToolSet } from "ai";
import { WebAppGenerator } from "../lib/generator";
import { createOpenAIGenerator } from "../lib/client";
import { useConversationStore } from "../store/conversation";
import { useSettingsStore } from "../store/settings";
import { useInteractiveStore } from "../store/interactive";
import { BUILTIN_TOOLS } from "../lib/ai-tools";
import { useSandpackStore } from "../store/sandpack";
import {
  SEARCH_TOOLS,
  WEB_READER_TOOL,
  createSearchToolHandler,
  createJinaReaderHandler,
} from "../lib/search";
import {
  ASSET_SEARCH_TOOLS,
  createAssetSearchToolHandler,
} from "../lib/assetSearch";
import { NPM_SEARCH_TOOLS, createNpmSearchToolHandler } from "../lib/npmSearch";
import {
  MEMORY_TOOLS,
  MEMORY_TOOL_NAME,
  createMemoryToolHandler,
  buildMemoryPromptSection,
} from "../lib/memory";
import { getBuiltinSearchConfig } from "../lib/ai-provider";
import { useSnapshotStore } from "../store/snapshot";
import { mergeMessages } from "../lib/mergeMessages";
import { compressContext as doCompress } from "../lib/compressContext";
import { generateSmartTitle } from "../lib/smartTitle";
import { DEFAULT_TITLE } from "../store/conversation";
import type {
  Message,
  ContentPart,
  Conversation,
  ProjectFiles,
  AISettings,
  WebSearchSettings,
  AssetSearchSettings,
  Attachment,
} from "../types";
import { ServerServiceSettings, SERVER_ENGINE } from "../store/settings";
import { useAuthStore } from "../store/auth";
import { getMohuaApiUrl } from "../lib/mohua-api";

interface EffectiveAIConfig {
  isAuth: boolean;
  apiType: AISettings["apiType"];
  apiKey: string;
  apiBaseUrl: string;
  model: string;
}

function getEffectiveAIConfig(
  token: string | null,
  settings: AISettings,
  serverServiceSettings: ServerServiceSettings,
): EffectiveAIConfig {
  const mohuaUrl = getMohuaApiUrl();
  const isAuth = !!token && !!mohuaUrl;
  return {
    isAuth,
    apiType: isAuth ? "openai-compatible" : settings.apiType,
    apiKey: isAuth ? (token as string) : settings.apiKey,
    apiBaseUrl: isAuth ? (mohuaUrl as string) : settings.apiBaseUrl,
    model: isAuth ? serverServiceSettings.selectedModel : settings.model,
  };
}

const isErrorMessage = (m: Message) =>
  m.role === "assistant" &&
  typeof m.content === "string" &&
  m.content.startsWith("⚠️");

const removeErrorMessages = (prev: Message[]) =>
  prev.filter((m) => !isErrorMessage(m));

/**
 * Filter out memory-related messages from the message array.
 * Memory messages are:
 *  - assistant messages where tool_calls contains manage_memories
 *  - tool result messages with tool_call_ids matching manage_memories calls
 *
 * If an assistant message has BOTH text content AND memory tool_calls,
 * keep the text but strip the memory tool_calls.
 */
function filterMemoryMessages(messages: Message[]): Message[] {
  // First pass: collect all manage_memories tool_call IDs
  const memoryToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === MEMORY_TOOL_NAME) {
          memoryToolCallIds.add(tc.id);
        }
      }
    }
  }

  if (memoryToolCallIds.size === 0) return messages;

  // Second pass: filter
  const result: Message[] = [];
  for (const msg of messages) {
    // Skip tool result messages for memory operations
    if (
      msg.role === "tool" &&
      msg.tool_call_id &&
      memoryToolCallIds.has(msg.tool_call_id)
    ) {
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls) {
      const nonMemoryToolCalls = msg.tool_calls.filter(
        (tc) => tc.function.name !== MEMORY_TOOL_NAME,
      );

      if (nonMemoryToolCalls.length === 0) {
        // All tool_calls were memory operations
        if (msg.content) {
          // Keep the text content, remove tool_calls
          result.push({ ...msg, tool_calls: undefined });
        }
        // If no content either, skip the entire message
        continue;
      }

      // Some tool_calls were non-memory — keep those
      result.push({ ...msg, tool_calls: nonMemoryToolCalls });
      continue;
    }

    result.push(msg);
  }

  return result;
}

/** Apply compression: return summary + messages after compression point */
function getMessagesForAPI(conv: Conversation): Message[] {
  const ctx = conv.compressedContext;
  if (!ctx) return removeErrorMessages(conv.messages);
  const recent = removeErrorMessages(conv.messages.slice(ctx.fromIndex));
  console.log(
    "[compress-debug] fromIndex:",
    ctx.fromIndex,
    "total:",
    conv.messages.length,
    "recent:",
    recent.length,
    "summary:",
    ctx.summary.slice(0, 60),
  );
  return [
    {
      role: "user",
      content: `[Previous conversation summary]\n${ctx.summary}`,
    },
    {
      role: "assistant",
      content:
        "Understood. I'll continue based on the conversation summary above.",
    },
    ...recent,
  ];
}

/** Create a snapshot for the current conversation state */
function createSnapshotForCurrentState() {
  const state = useConversationStore.getState();
  const conv = state.activeId ? state.conversations[state.activeId] : null;
  if (!conv || Object.keys(conv.files).length === 0) return;
  const merged = mergeMessages(conv.messages);
  for (let i = merged.length - 1; i >= 0; i--) {
    if (merged[i].role === "assistant") {
      useSnapshotStore
        .getState()
        .createSnapshot(conv.id, merged[i].id, conv.files);
      return;
    }
  }
}

// Builtin tools that mutate project files. Filtered out when plan mode is on.
const WRITE_BUILTIN_TOOLS = new Set([
  "init_project",
  "manage_dependencies",
  "write_file",
  "patch_file",
  "delete_file",
]);

const PLAN_MODE_SYSTEM_SUFFIX = `

## PLAN MODE ACTIVE
You are in Plan Mode. You MUST NOT write, modify, or delete any project files.
The write tools (init_project, write_file, patch_file, delete_file, manage_dependencies) are NOT available right now.
Workflow:
  1. Use list_files / read_files / search_in_files to fully understand the existing project.
  2. If a key requirement is ambiguous, call ask_user_question before continuing.
  3. Synthesize a complete implementation plan in clear Markdown — what files to add/change, what dependencies to add, what the overall approach is, and how to verify it works.
  4. Call exit_plan_mode with the plan as your FINAL step. Do NOT write the plan as a normal reply.
After the user approves the plan, exit_plan_mode will return success and the write tools will become available — only then start implementing.`;

function buildToolSet(args: {
  custom: ToolSet;
  planMode: boolean;
}): ToolSet {
  const { custom, planMode } = args;
  const builtinEntries = Object.entries(BUILTIN_TOOLS).filter(([name]) => {
    if (planMode) return !WRITE_BUILTIN_TOOLS.has(name);
    // Outside plan mode, exit_plan_mode has no meaning.
    return name !== "exit_plan_mode";
  });
  return { ...Object.fromEntries(builtinEntries), ...custom };
}

interface UseGeneratorOptions {
  settings: AISettings;
  webSearchSettings: WebSearchSettings;
  assetSearchSettings: AssetSearchSettings;
  serverServiceSettings: ServerServiceSettings;
  files: ProjectFiles;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setFiles: Dispatch<SetStateAction<ProjectFiles>>;
  setIsGenerating: Dispatch<SetStateAction<boolean>>;
  setTemplate: Dispatch<SetStateAction<string>>;
  restartSandpack: () => void;
  setIsProjectInitialized: Dispatch<SetStateAction<boolean>>;
}

export function useGenerator({
  settings,
  webSearchSettings,
  assetSearchSettings,
  serverServiceSettings,
  files,
  setMessages,
  setFiles,
  setIsGenerating,
  setTemplate,
  restartSandpack,
  setIsProjectInitialized,
}: UseGeneratorOptions) {
  const generatorRef = useRef<WebAppGenerator | null>(null);
  const activeId = useConversationStore((s) => s.activeId);
  const prevActiveIdRef = useRef(activeId);
  const textBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const typewriterTimerRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);
  const lastCharTimeRef = useRef(0);
  const lastThinkingTimeRef = useRef(0);

  /** Flush all remaining thinking buffer content at once */
  const flushThinkingBuffer = () => {
    if (thinkingTimerRef.current) {
      cancelAnimationFrame(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    if (thinkingBufferRef.current) {
      const remaining = thinkingBufferRef.current;
      thinkingBufferRef.current = "";
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, thinking: (last.thinking || "") + remaining },
          ];
        }
        return prev;
      });
    }
  };

  const getGenerator = useCallback(() => {
    const token = useAuthStore.getState().getValidToken();
    const cfg = getEffectiveAIConfig(token, settings, serverServiceSettings);
    const { isAuth, apiType: currentApiType, apiKey: currentApiKey, apiBaseUrl: currentApiBaseUrl, model: currentModel } = cfg;

    if (!isAuth && (!settings.apiKey || !settings.apiBaseUrl || !settings.model))
      return null;

    const currentSearchEngine = isAuth
      ? (serverServiceSettings.webSearchEnabled ? SERVER_ENGINE : "disabled")
      : webSearchSettings.engine;
    const currentAssetEngine = isAuth
      ? (serverServiceSettings.assetSearchEnabled ? SERVER_ENGINE : "disabled")
      : assetSearchSettings.engine;

    // Invalidate on conversation switch
    if (prevActiveIdRef.current !== activeId) {
      generatorRef.current = null;
      prevActiveIdRef.current = activeId;
      useInteractiveStore
        .getState()
        .rejectAllPending("conversation switched");
    }

    // Invalidate if settings changed
    if (generatorRef.current) {
      const g = generatorRef.current as any;
      if (
        g._apiType !== currentApiType ||
        g._apiKey !== currentApiKey ||
        g._apiBaseUrl !== currentApiBaseUrl ||
        g._model !== currentModel ||
        g._searchEngine !== currentSearchEngine ||
        g._firecrawlKey !== webSearchSettings.firecrawlApiKey ||
        g._assetEngine !== currentAssetEngine ||
        g._pixabayKey !== assetSearchSettings.pixabayApiKey
      ) {
        generatorRef.current = null;
      }
    }

    if (!generatorRef.current) {
      const isBuiltinSearch = !isAuth && webSearchSettings.engine === "builtin";
      const webConfigured = isAuth
        ? serverServiceSettings.webSearchEnabled
        : (!isBuiltinSearch && useSettingsStore.getState().isWebSearchConfigured());
      const assetConfigured = isAuth
        ? serverServiceSettings.assetSearchEnabled
        : useSettingsStore.getState().isAssetSearchConfigured();

      // For builtin search: get provider-managed config + Jina reader
      // For tavily/firecrawl: use custom search handler as before
      let builtinSearchTools: Record<string, unknown> = {};
      let providerToolNames: string[] = [];
      if (isBuiltinSearch) {
        const builtinConfig = getBuiltinSearchConfig({
          apiType: currentApiType,
          apiBaseUrl: currentApiBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
        });
        if (builtinConfig) {
          builtinSearchTools = builtinConfig.tools || {};
          providerToolNames = builtinConfig.providerToolNames;
        }
      }

      const effectiveWebSearchSettings = isAuth
        ? { ...webSearchSettings, engine: SERVER_ENGINE, backendProvider: serverServiceSettings.webSearchProviderId }
        : webSearchSettings;
      const effectiveAssetSearchSettings = isAuth
        ? { ...assetSearchSettings, engine: SERVER_ENGINE, backendProvider: serverServiceSettings.assetSearchProviderId }
        : assetSearchSettings;

      const searchHandler = webConfigured
        ? createSearchToolHandler(effectiveWebSearchSettings)
        : undefined;
      const jinaReaderHandler = isBuiltinSearch || isAuth
        ? createJinaReaderHandler()
        : undefined;
      const assetSearchHandler = assetConfigured
        ? createAssetSearchToolHandler(effectiveAssetSearchSettings)
        : undefined;
      const memoryHandler = createMemoryToolHandler();
      const npmSearchHandler = createNpmSearchToolHandler();

      const combinedToolHandler = async (
        name: string,
        args: unknown,
      ): Promise<string> => {
        if (name === "get_console_logs") {
          const { consoleLogs } = useSandpackStore.getState();
          if (consoleLogs.length === 0) return "No console output yet.";
          return consoleLogs
            .map((log) => {
              const data = log.data
                .map((d) => (typeof d === "string" ? d : JSON.stringify(d)))
                .join(" ");
              return `[${log.method.toUpperCase()}] ${data}`;
            })
            .join("\n");
        }
        if (name === MEMORY_TOOL_NAME) {
          return memoryHandler(name, args);
        }
        if (
          name === "search_npm_packages" ||
          name === "get_npm_package_detail"
        ) {
          return npmSearchHandler(name, args);
        }
        if (name === "image_search" && assetSearchHandler) {
          return assetSearchHandler(name, args);
        }
        if (name === "web_reader" && jinaReaderHandler) {
          return jinaReaderHandler(name, args);
        }
        if (searchHandler) return searchHandler(name, args);
        return `Error: unknown tool "${name}"`;
      };

      const customToolSet: ToolSet = {
        ...(webConfigured ? SEARCH_TOOLS : {}),
        ...builtinSearchTools,
        ...(isBuiltinSearch || isAuth ? WEB_READER_TOOL : {}),
        ...(assetConfigured ? ASSET_SEARCH_TOOLS : {}),
        ...NPM_SEARCH_TOOLS,
        ...MEMORY_TOOLS,
      };

      const initialPlanMode =
        useSettingsStore.getState().system.planModeEnabled;
      const initialTools = buildToolSet({
        custom: customToolSet,
        planMode: initialPlanMode,
      });

      generatorRef.current = createOpenAIGenerator(
        {
          apiType: currentApiType,
          apiKey: currentApiKey,
          apiBaseUrl: currentApiBaseUrl,
          model: currentModel,
          stream: true,
          providerToolNames,
        },
        {
          onText: (delta) => {
            // First text-delta means thinking is complete — flush remaining thinking at once
            flushThinkingBuffer();
            textBufferRef.current += delta;
            if (!typewriterTimerRef.current) {
              const typeChar = (timestamp: number) => {
                if (timestamp - lastCharTimeRef.current >= 20) {
                  if (textBufferRef.current.length > 0) {
                    const char = textBufferRef.current[0];
                    textBufferRef.current = textBufferRef.current.slice(1);
                    setMessages((prev) => {
                      const last = prev[prev.length - 1];
                      if (last?.role === "assistant") {
                        return [
                          ...prev.slice(0, -1),
                          {
                            ...last,
                            content:
                              ((typeof last.content === "string"
                                ? last.content
                                : "") || "") + char,
                          },
                        ];
                      }
                      return [...prev, { role: "assistant", content: char }];
                    });
                    lastCharTimeRef.current = timestamp;
                  }
                }
                if (
                  textBufferRef.current.length > 0 ||
                  typewriterTimerRef.current
                ) {
                  typewriterTimerRef.current = requestAnimationFrame(typeChar);
                } else {
                  typewriterTimerRef.current = null;
                }
              };
              typewriterTimerRef.current = requestAnimationFrame(typeChar);
            }
          },
          onThinking: (delta) => {
            thinkingBufferRef.current += delta;
            if (!thinkingTimerRef.current) {
              const typeThinking = (timestamp: number) => {
                if (timestamp - lastThinkingTimeRef.current >= 20) {
                  if (thinkingBufferRef.current.length > 0) {
                    const char = thinkingBufferRef.current[0];
                    thinkingBufferRef.current =
                      thinkingBufferRef.current.slice(1);
                    setMessages((prev) => {
                      const last = prev[prev.length - 1];
                      if (last?.role === "assistant") {
                        return [
                          ...prev.slice(0, -1),
                          { ...last, thinking: (last.thinking || "") + char },
                        ];
                      }
                      return [
                        ...prev,
                        { role: "assistant", content: null, thinking: char },
                      ];
                    });
                    lastThinkingTimeRef.current = timestamp;
                  }
                }
                if (
                  thinkingBufferRef.current.length > 0 ||
                  thinkingTimerRef.current
                ) {
                  thinkingTimerRef.current =
                    requestAnimationFrame(typeThinking);
                } else {
                  thinkingTimerRef.current = null;
                }
              };
              thinkingTimerRef.current = requestAnimationFrame(typeThinking);
            }
          },
          onToolCall: (name, id) => {
            // Thinking is complete when tool calls arrive — flush remaining thinking at once
            flushThinkingBuffer();
            // Flush text buffer before tool call to prevent text insertion issues
            if (typewriterTimerRef.current) {
              cancelAnimationFrame(typewriterTimerRef.current);
              typewriterTimerRef.current = null;
            }
            if (textBufferRef.current) {
              const remainingText = textBufferRef.current;
              textBufferRef.current = "";
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      content:
                        ((typeof last.content === "string"
                          ? last.content
                          : "") || "") + remainingText,
                    },
                  ];
                }
                return prev;
              });
            }

            const actualId =
              id || `call_${Math.random().toString(36).substring(2, 11)}`;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              const newToolCall = {
                id: actualId,
                type: "function" as const,
                function: { name, arguments: "" },
              };
              if (last?.role === "assistant") {
                if (last.tool_calls?.some((tc) => tc.id === actualId))
                  return prev;
                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    tool_calls: [...(last.tool_calls || []), newToolCall],
                  },
                ];
              }
              // No assistant message yet (model returned tool calls without text).
              // Create one so onToolResult can find the matching tool call later.
              return [
                ...prev,
                {
                  role: "assistant" as const,
                  content: null,
                  tool_calls: [newToolCall],
                },
              ];
            });
          },
          onToolResult: (_name, _args, result) => {
            setMessages((prev) => {
              const msgs = [...prev];
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === "assistant" && msgs[i].tool_calls) {
                  const toolCallIndex = msgs[i].tool_calls!.findIndex(
                    (tc) =>
                      !msgs.some(
                        (m) => m.role === "tool" && m.tool_call_id === tc.id,
                      ),
                  );
                  if (toolCallIndex !== -1) {
                    const toolCall = msgs[i].tool_calls![toolCallIndex];
                    // Update the tool call's arguments so the UI can display correct info
                    const updatedToolCalls = [...msgs[i].tool_calls!];
                    updatedToolCalls[toolCallIndex] = {
                      ...toolCall,
                      function: {
                        ...toolCall.function,
                        arguments: JSON.stringify(_args),
                      },
                    };
                    const updatedMsgs = [...msgs];
                    updatedMsgs[i] = {
                      ...msgs[i],
                      tool_calls: updatedToolCalls,
                    };
                    return [
                      ...updatedMsgs,
                      {
                        role: "tool",
                        content: result,
                        tool_call_id: toolCall.id,
                      },
                    ];
                  }
                  break;
                }
              }
              // If not found, we shouldn't add an empty tool_call_id, but rather discard or warn,
              // since OpenAI API rejects empty tool_call_id strings.
              // Just to be safe, if we somehow don't find it, we skip appending or use a dummy ID.
              // However, since it only gets emitted from the parser, it should always have an ID.
              // Let's log a warning but still append to avoid losing the result, except we MUST have a valid ID.
              console.warn(
                "Couldn't find matching tool call for result:",
                _name,
              );
              return prev;
            });
          },
          onFileChange: (newFiles) => {
            setFiles(newFiles);
          },
          onTemplateChange: (tmpl, newFiles) => {
            setTemplate(tmpl);
            setFiles(newFiles);
            setIsProjectInitialized(true);
            restartSandpack();
          },
          onDependenciesChange: (newFiles) => {
            setFiles(newFiles);
            restartSandpack();
          },
          onComplete: () => {
            if (typewriterTimerRef.current) {
              cancelAnimationFrame(typewriterTimerRef.current);
              typewriterTimerRef.current = null;
            }
            flushThinkingBuffer();
            if (textBufferRef.current) {
              const remainingText = textBufferRef.current;
              textBufferRef.current = "";
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      content:
                        ((typeof last.content === "string"
                          ? last.content
                          : "") || "") + remainingText,
                    },
                  ];
                }
                return prev;
              });
            }
            createSnapshotForCurrentState();

            // Smart naming: generate title if still using default
            const convState = useConversationStore.getState();
            const conv = convState.activeId
              ? convState.conversations[convState.activeId]
              : null;
            if (conv && conv.title === DEFAULT_TITLE) {
              generateSmartTitle(
                conv.messages,
                currentApiType,
                currentApiBaseUrl,
                currentApiKey,
                currentModel,
              )
                .then((title) => {
                  if (title) {
                    const current = useConversationStore.getState();
                    const currentConv = current.conversations[conv.id];
                    if (currentConv && currentConv.title === DEFAULT_TITLE) {
                      useConversationStore
                        .getState()
                        .renameConversation(conv.id, title);
                    }
                  }
                })
                .catch(() => {
                  // Silently ignore smart naming failures
                });
            }
          },
          onError: (error) => {
            console.error("Generation error:", error);
          },
          onRetry: (attempt, maxAttempts, error) => {
            console.warn(
              `Retrying API request (${attempt}/${maxAttempts}):`,
              error.message,
            );
            // Clear partial assistant message from the failed attempt
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.slice(0, -1);
              }
              return prev;
            });
          },
          onCompact: async () => {
            const token = await useAuthStore.getState().getValidTokenAsync();
            const s = useConversationStore.getState();
            const conv = s.activeId ? s.conversations[s.activeId] : null;
            if (!conv) return null;
            const cfg = getEffectiveAIConfig(token, settings, serverServiceSettings);

            const result = await doCompress(
              conv.messages,
              cfg.apiType,
              cfg.apiBaseUrl,
              cfg.apiKey,
              cfg.model,
              conv.compressedContext,
            );
            if (!result) return null;
            useConversationStore.getState().setCompressedContext(result);
            return getMessagesForAPI({ ...conv, compressedContext: result });
          },
        },
        files,
        customToolSet,
        combinedToolHandler,
        {
          tools: initialTools,
          askUserQuestion: (toolCallId, questions) =>
            useInteractiveStore.getState().askQuestion({
              toolCallId,
              questions,
            }),
          requestPlanApproval: (toolCallId, plan) =>
            useInteractiveStore.getState().askPlanApproval({
              toolCallId,
              plan,
            }),
          onPlanApproved: () => {
            const { system, setSystem } = useSettingsStore.getState();
            if (system.planModeEnabled) {
              setSystem({ ...system, planModeEnabled: false });
            }
            return buildToolSet({
              custom: customToolSet,
              planMode: false,
            });
          },
        },
      );

      const gen = generatorRef.current as any;
      gen._apiType = currentApiType;
      gen._apiKey = currentApiKey;
      gen._apiBaseUrl = currentApiBaseUrl;
      gen._model = currentModel;
      gen._searchEngine = currentSearchEngine;
      gen._firecrawlKey = webSearchSettings.firecrawlApiKey;
      gen._assetEngine = currentAssetEngine;
      gen._pixabayKey = assetSearchSettings.pixabayApiKey;
    }

    return generatorRef.current;
  }, [
    settings,
    webSearchSettings,
    assetSearchSettings,
    serverServiceSettings,
    files,
    activeId,
    setMessages,
    setFiles,
    setTemplate,
    setIsProjectInitialized,
    restartSandpack,
  ]);

  // Apply state that can change between generations: tool set (plan mode toggle),
  // system prompt suffix (memory + plan mode addendum). Called at the start of every run.
  const applyDynamicGeneratorState = useCallback(
    (generator: WebAppGenerator) => {
      const planMode = useSettingsStore.getState().system.planModeEnabled;
      const customToolSet = generator.getCustomToolSet();
      generator.setTools(buildToolSet({ custom: customToolSet, planMode }));
      const memorySuffix = buildMemoryPromptSection();
      generator.setSystemPromptSuffix(
        memorySuffix + (planMode ? PLAN_MODE_SYSTEM_SUFFIX : ""),
      );
    },
    [],
  );

  const generate = useCallback(
    async (prompt: string, attachments?: Attachment[]) => {
      setIsGenerating(true);
      await useAuthStore.getState().getValidTokenAsync();

      // Build message content: multi-part if attachments present, plain string otherwise
      let content: string | ContentPart[];
      if (attachments && attachments.length > 0) {
        const parts: ContentPart[] = [];
        if (prompt) parts.push({ type: "text", text: prompt });
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
        content = parts;
      } else {
        content = prompt;
      }

      // Get generator and sync its messages with the store BEFORE adding the new user message.
      // This ensures the generator has the full conversation history even if it was recreated
      // (e.g. after page refresh, settings change, or conversation switch).
      const generator = getGenerator();
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = storeState.activeId
          ? storeState.conversations[storeState.activeId]
          : null;
        if (activeConv) {
          generator.syncMessages(getMessagesForAPI(activeConv));
        }
        applyDynamicGeneratorState(generator);
      }
      // Clear any abandoned pending interactive prompts before a fresh run.
      useInteractiveStore.getState().rejectAllPending("new generation started");

      setMessages((prev) => [
        ...removeErrorMessages(prev),
        { role: "user", content },
      ]);
      try {
        if (generator) await generator.generate(prompt, attachments);
      } catch (err: any) {
        console.error("Error generating:", err);
        if (err?.name !== "AbortError") {
          setMessages((prev) => [
            ...removeErrorMessages(prev),
            {
              role: "assistant",
              content: `⚠️ ${err?.message || "Unknown error"}`,
            },
          ]);
        }
      } finally {
        // Filter memory messages from the persisted conversation (silent operation)
        setMessages((prev) => filterMemoryMessages(prev));
        setIsGenerating(false);
      }
    },
    [getGenerator, setIsGenerating, setMessages, applyDynamicGeneratorState],
  );

  const stop = useCallback(() => {
    if (typewriterTimerRef.current) {
      cancelAnimationFrame(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    if (thinkingTimerRef.current) {
      cancelAnimationFrame(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    if (textBufferRef.current || thinkingBufferRef.current) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: textBufferRef.current
                ? ((typeof last.content === "string" ? last.content : "") ||
                    "") + textBufferRef.current
                : last.content,
              thinking: thinkingBufferRef.current
                ? (last.thinking || "") + thinkingBufferRef.current
                : last.thinking,
            },
          ];
        }
        return prev;
      });
      textBufferRef.current = "";
      thinkingBufferRef.current = "";
    }
    generatorRef.current?.abort();
    useInteractiveStore.getState().rejectAllPending("user stopped");
    setIsGenerating(false);
    createSnapshotForCurrentState();
  }, [setIsGenerating]);

  const updateFiles = useCallback(
    (path: string, content: string) => {
      setFiles((prev) => {
        const next = { ...prev, [path]: content };
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles],
  );

  const deleteFile = useCallback(
    (path: string) => {
      setFiles((prev) => {
        const next = { ...prev };
        const prefix = path + "/";
        for (const key of Object.keys(next)) {
          if (key === path || key.startsWith(prefix)) {
            delete next[key];
          }
        }
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles],
  );

  const renameFile = useCallback(
    (oldPath: string, newPath: string) => {
      setFiles((prev) => {
        const next: ProjectFiles = {};
        const prefix = oldPath + "/";
        for (const [key, value] of Object.entries(prev)) {
          if (key === oldPath) {
            next[newPath] = value;
          } else if (key.startsWith(prefix)) {
            next[newPath + key.slice(oldPath.length)] = value;
          } else {
            next[key] = value;
          }
        }
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles],
  );

  const moveFile = useCallback(
    (sourcePath: string, targetFolder: string) => {
      const fileName = sourcePath.split("/").pop()!;
      const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      renameFile(sourcePath, newPath);
    },
    [renameFile],
  );

  const retry = useCallback(async () => {
    setIsGenerating(true);
    // Remove error messages and incomplete tool calls (assistant tool_calls with no matching tool result)
    setMessages((prev) => {
      const toolResultIds = new Set(
        prev.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
      );
      return prev.filter((m) => {
        if (isErrorMessage(m)) return false;
        if (m.role === "assistant" && m.tool_calls?.length) {
          return m.tool_calls.every((tc) => toolResultIds.has(tc.id));
        }
        return true;
      });
    });
    try {
      const generator = getGenerator();
      if (generator) {
        // Sync messages from store (error message already removed by setMessages above)
        const storeState = useConversationStore.getState();
        const activeConv = storeState.activeId
          ? storeState.conversations[storeState.activeId]
          : null;
        if (activeConv) {
          generator.syncMessages(getMessagesForAPI(activeConv));
        }
        applyDynamicGeneratorState(generator);
        await generator.retry();
      }
    } catch (err: any) {
      console.error("Error retrying:", err);
      if (err?.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${err?.message || "Unknown error"}`,
          },
        ]);
      }
    } finally {
      setMessages((prev) => filterMemoryMessages(prev));
      setIsGenerating(false);
    }
  }, [getGenerator, setIsGenerating, setMessages, applyDynamicGeneratorState]);

  const compressContext = useCallback(async () => {
    const storeState = useConversationStore.getState();
    const conv = storeState.activeId
      ? storeState.conversations[storeState.activeId]
      : null;
    if (!conv) return;

    setIsGenerating(true);
    try {
      const result = await doCompress(
        conv.messages,
        settings.apiType,
        settings.apiBaseUrl,
        settings.apiKey,
        settings.model,
        conv.compressedContext,
      );
      if (result) {
        useConversationStore.getState().setCompressedContext(result);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...removeErrorMessages(prev),
        {
          role: "assistant",
          content: `⚠️ ${err?.message || "Compression failed"}`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  }, [settings, setMessages, setIsGenerating]);

  const review = useCallback(async () => {
    await generate(
      "Please review all project files for security vulnerabilities. Use list_files and read_files to examine the code. Report any security issues found with severity and location, or confirm no issues were detected. If issues are found, ask if I should fix them automatically.",
    );
  }, [generate]);

  const continueTask = useCallback(async () => {
    setIsGenerating(true);
    try {
      const generator = getGenerator();
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = storeState.activeId
          ? storeState.conversations[storeState.activeId]
          : null;
        if (activeConv) {
          generator.syncMessages(getMessagesForAPI(activeConv));
        }
        applyDynamicGeneratorState(generator);
        await generator.generate(
          "Please continue where you left off and complete any unfinished tasks.",
        );
      }
    } catch (err: any) {
      console.error("Error continuing:", err);
      if (err?.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${err?.message || "Unknown error"}`,
          },
        ]);
      }
    } finally {
      setMessages((prev) => filterMemoryMessages(prev));
      setIsGenerating(false);
    }
  }, [getGenerator, setIsGenerating, setMessages, applyDynamicGeneratorState]);

  return {
    generate,
    stop,
    retry,
    continueTask,
    updateFiles,
    deleteFile,
    renameFile,
    moveFile,
    compressContext,
    review,
  };
}
