import { useRef, useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ToolSet } from "ai";
import type { GenerateResult, WebAppGenerator } from "../lib/ai/generator";
import { useConversationStore } from "../store/conversation";
import { useSettingsStore } from "../store/settings";
import { useInteractiveStore } from "../store/interactive";
import { useSubagentStore } from "../store/subagent";
import { useSandpackStore } from "../store/sandpack";
import { filterMemoryMessages } from "../lib/utils/memory-filter";
import { createSnapshotForCurrentState } from "../lib/utils/snapshot-helpers";
import type {
  Message,
  ContentPart,
  Conversation,
  ProjectFiles,
  AISettings,
  WebSearchSettings,
  AssetSearchSettings,
  Attachment,
  GeneratorRunState,
  StructuredGenerationError,
} from "../types";
import { ServerServiceSettings, SERVER_ENGINE } from "../store/settings";
import { useAuthStore } from "../store/auth";
import { useMemoryStore } from "../store/memory";
import { useSkillsStore } from "../store/skills";
import { useStyleAssetStore } from "../store/style-assets";
import { getMohuaApiUrl } from "../lib/services/mohua-api";
import { useFileOperations } from "./useFileOperations";
import { useTitleAndCompression } from "./useTitleAndCompression";
import { buildStyleAssetPromptSection } from "../lib/utils/style-assets";

interface EffectiveAIConfig {
  isAuth: boolean;
  apiType: AISettings["apiType"];
  apiKey: string;
  apiBaseUrl: string;
  model: string;
}

interface GeneratorConfigSnapshot {
  apiType: AISettings["apiType"];
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  searchEngine: string;
  firecrawlKey: string;
  assetEngine: string;
  pixabayKey: string;
}

function sameGeneratorConfig(
  a: GeneratorConfigSnapshot | null,
  b: GeneratorConfigSnapshot,
): boolean {
  if (!a) return false;
  return (
    a.apiType === b.apiType &&
    a.apiKey === b.apiKey &&
    a.apiBaseUrl === b.apiBaseUrl &&
    a.model === b.model &&
    a.searchEngine === b.searchEngine &&
    a.firecrawlKey === b.firecrawlKey &&
    a.assetEngine === b.assetEngine &&
    a.pixabayKey === b.pixabayKey
  );
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

const isErrorMessage = (m: Message) => {
  if (m.role !== "assistant") return false;
  if (m.isError) return true;
  // Backward-compat: legacy persisted error messages used a ⚠️ prefix
  // before the structured flag existed.
  return typeof m.content === "string" && m.content.startsWith("⚠️");
};

const removeErrorMessages = (prev: Message[]) =>
  prev.filter((m) => !isErrorMessage(m));

/** Apply compression: return summary + messages after compression point. */
function getMessagesForAPI(conv: Conversation): Message[] {
  const ctx = conv.compressedContext;
  if (!ctx) return removeErrorMessages(conv.messages);
  const recent = removeErrorMessages(conv.messages.slice(ctx.fromIndex));
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

const PLAN_MODE_SYSTEM_SUFFIX = `

## PLAN MODE ACTIVE
You are in Plan Mode. You MUST NOT write, modify, or delete any project files.
All write tools (init_project, manage_dependencies, write_file, patch_file, delete_file, rename_file, move_file, manage_env, install_component, screenshot_to_code) are NOT available right now.
Workflow:
  1. Use list_files / read_files / search_in_files to fully understand the existing project.
  2. If a key requirement is ambiguous, call ask_user_question before continuing.
  3. Synthesize a complete implementation plan in clear Markdown — what files to add/change, what dependencies to add, what the overall approach is, and how to verify it works.
  4. Call exit_plan_mode with the plan as your FINAL step. Do NOT write the plan as a normal reply.
After the user approves the plan, exit_plan_mode will return success and the write tools will become available — only then start implementing.`;

const AUTO_QA_PROMPT =
  "Automatic QA round: call project_health_check with include_console=true. " +
  "If the report contains errors or warnings that clearly break build/runtime behavior, fix them with the available file tools. " +
	  "Do not make broad redesigns or optional refactors. If only informational issues remain, summarize them and stop.";

function classifyGenerationError(err: any): StructuredGenerationError {
  const message = err?.message || "Unknown error";
  const status = typeof err?.status === "number" ? err.status : undefined;
  if (err?.name === "AbortError") {
    return { kind: "aborted", message, retryable: false, status };
  }
  if (/context_length_exceeded|context length|maximum context/i.test(message)) {
    return { kind: "context_length", message, retryable: true, status };
  }
  if (status === 401 || status === 403 || /api key|unauthorized|forbidden/i.test(message)) {
    return { kind: "auth", message, retryable: false, status };
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return { kind: "model", message, retryable: true, status };
  }
  if (/network|fetch|timeout|timed out/i.test(message)) {
    return { kind: "network", message, retryable: true, status };
  }
  if (/tool|invalid arguments|schema/i.test(message)) {
    return { kind: "tool", message, retryable: true, status };
  }
  return { kind: "unknown", message, retryable: true, status };
}

interface GenerateRunOptions {
  skipAutoQa?: boolean;
}

interface GeneratorRuntime {
  createOpenAIGenerator: typeof import("../lib/ai/client").createOpenAIGenerator;
  buildToolHandlers: typeof import("../lib/tools/handler-factory").buildToolHandlers;
  createSubagentDispatcher: typeof import("../lib/ai/subagents/runner").createSubagentDispatcher;
  runCompress: typeof import("../lib/utils/run-compress").runCompress;
  buildMemoryPromptSection: typeof import("../lib/tools/memory").buildMemoryPromptSection;
  buildSkillsPromptSection: typeof import("../lib/skills/tool-handler").buildSkillsPromptSection;
  skillActiveContext: typeof import("../lib/skills/active-context").skillActiveContext;
  buildToolSet: (args: { custom: ToolSet; planMode: boolean }) => ToolSet;
}

let generatorRuntimePromise: Promise<GeneratorRuntime> | null = null;

function loadGeneratorRuntime(): Promise<GeneratorRuntime> {
  generatorRuntimePromise ??= Promise.all([
    import("../lib/ai/client"),
    import("../lib/ai/tools-schema"),
    import("../lib/tools/tool-set-utils"),
    import("../lib/tools/memory"),
    import("../lib/tools/handler-factory"),
    import("../lib/ai/subagents/runner"),
    import("../lib/utils/run-compress"),
    import("../lib/skills/tool-handler"),
    import("../lib/skills/active-context"),
  ]).then(
    ([
      client,
      toolsSchema,
      toolSetUtils,
      memory,
      handlerFactory,
      subagentRunner,
      runCompressModule,
      skillToolHandler,
      activeContext,
    ]) => {
      const buildToolSet = ({
        custom,
        planMode,
      }: {
        custom: ToolSet;
        planMode: boolean;
      }): ToolSet => {
	        const builtins = toolSetUtils.filterToolSet(
	          toolsSchema.BUILTIN_TOOLS,
	          (name) =>
	            planMode
	              ? toolsSchema.isPlanModeToolVisible(name)
	              : name !== "exit_plan_mode",
	        );
	        const customs = toolSetUtils.filterToolSet(custom, (name) =>
	          planMode ? toolsSchema.isPlanModeToolVisible(name) : true,
	        );
	        return { ...builtins, ...customs };
	      };

      return {
        createOpenAIGenerator: client.createOpenAIGenerator,
        buildToolHandlers: handlerFactory.buildToolHandlers,
        createSubagentDispatcher: subagentRunner.createSubagentDispatcher,
        runCompress: runCompressModule.runCompress,
        buildMemoryPromptSection: memory.buildMemoryPromptSection,
        buildSkillsPromptSection: skillToolHandler.buildSkillsPromptSection,
        skillActiveContext: activeContext.skillActiveContext,
        buildToolSet,
      };
    },
  );
  return generatorRuntimePromise;
}

interface UseGeneratorOptions {
  settings: AISettings;
  webSearchSettings: WebSearchSettings;
  assetSearchSettings: AssetSearchSettings;
  serverServiceSettings: ServerServiceSettings;
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
  setMessages,
  setFiles,
  setIsGenerating,
  setTemplate,
  restartSandpack,
  setIsProjectInitialized,
}: UseGeneratorOptions) {
	const generatorRef = useRef<WebAppGenerator | null>(null);
	const [runState, setRunState] = useState<GeneratorRunState>("idle");
	const [lastError, setLastError] = useState<StructuredGenerationError | null>(null);
  const generatorConfigRef = useRef<GeneratorConfigSnapshot | null>(null);
  const activeId = useConversationStore((s) => s.activeId);
  const prevActiveIdRef = useRef(activeId);
  const textBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const typewriterTimerRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);
  const lastCharTimeRef = useRef(0);
  const lastThinkingTimeRef = useRef(0);

  useEffect(
    () => () => {
      if (typewriterTimerRef.current) {
        cancelAnimationFrame(typewriterTimerRef.current);
      }
      if (thinkingTimerRef.current) {
        cancelAnimationFrame(thinkingTimerRef.current);
      }
      generatorRef.current?.abort();
    },
    [],
  );

  const { updateFiles, deleteFile, renameFile, moveFile } = useFileOperations({
    setFiles,
    generatorRef,
  });

  const resolveEffectiveConfig = useCallback(async () => {
    const token = await useAuthStore.getState().getValidTokenAsync();
    const cfg = getEffectiveAIConfig(token, settings, serverServiceSettings);
    return {
      apiType: cfg.apiType,
      apiBaseUrl: cfg.apiBaseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
    };
  }, [settings, serverServiceSettings]);

  const { triggerSmartTitle, compressContext } = useTitleAndCompression({
    resolveConfig: resolveEffectiveConfig,
    setIsGenerating,
    setMessages,
  });

  /** Flush all remaining thinking buffer content at once */
  const flushThinkingBuffer = useCallback(() => {
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
  }, [setMessages]);

  const getGenerator = useCallback(async () => {
    const token = useAuthStore.getState().getValidToken();
    const cfg = getEffectiveAIConfig(token, settings, serverServiceSettings);
    const {
      isAuth,
      apiType: currentApiType,
      apiKey: currentApiKey,
      apiBaseUrl: currentApiBaseUrl,
      model: currentModel,
    } = cfg;

    if (
      !isAuth &&
      (!settings.apiKey || !settings.apiBaseUrl || !settings.model)
    )
      return null;

    const currentSearchEngine = isAuth
      ? serverServiceSettings.webSearchEnabled
        ? SERVER_ENGINE
        : "disabled"
      : webSearchSettings.engine;
    const currentAssetEngine = isAuth
      ? serverServiceSettings.assetSearchEnabled
        ? SERVER_ENGINE
        : "disabled"
      : assetSearchSettings.engine;

    // Invalidate on conversation switch
    if (prevActiveIdRef.current !== activeId) {
      generatorRef.current = null;
      prevActiveIdRef.current = activeId;
      useInteractiveStore.getState().rejectAllPending("conversation switched");
      useSubagentStore.setState({ progress: {} });
    }

    const nextConfig: GeneratorConfigSnapshot = {
      apiType: currentApiType,
      apiKey: currentApiKey,
      apiBaseUrl: currentApiBaseUrl,
      model: currentModel,
      searchEngine: currentSearchEngine,
      firecrawlKey: webSearchSettings.firecrawlApiKey,
      assetEngine: currentAssetEngine,
      pixabayKey: assetSearchSettings.pixabayApiKey,
    };

    if (
      generatorRef.current &&
      !sameGeneratorConfig(generatorConfigRef.current, nextConfig)
    ) {
      generatorRef.current = null;
    }

    if (!generatorRef.current) {
      const runtime = await loadGeneratorRuntime();
      const isBuiltinSearch = !isAuth && webSearchSettings.engine === "builtin";
      const webConfigured = isAuth
        ? serverServiceSettings.webSearchEnabled
        : !isBuiltinSearch &&
          useSettingsStore.getState().isWebSearchConfigured();
      const assetConfigured = isAuth
        ? serverServiceSettings.assetSearchEnabled
        : useSettingsStore.getState().isAssetSearchConfigured();

      const effectiveWebSearchSettings = isAuth
        ? {
            ...webSearchSettings,
            engine: SERVER_ENGINE,
            backendProvider: serverServiceSettings.webSearchProviderId,
          }
        : webSearchSettings;
      const effectiveAssetSearchSettings = isAuth
        ? {
            ...assetSearchSettings,
            engine: SERVER_ENGINE,
            backendProvider: serverServiceSettings.assetSearchProviderId,
          }
        : assetSearchSettings;

      const { customToolSet, combinedToolHandler, providerToolNames } =
        runtime.buildToolHandlers({
          features: {
            auth: isAuth,
            builtinSearch: isBuiltinSearch,
            webSearch: webConfigured,
            assetSearch: assetConfigured,
          },
          effectiveWebSearchSettings,
          effectiveAssetSearchSettings,
          apiConfig: {
            apiType: currentApiType,
            apiBaseUrl: currentApiBaseUrl,
            apiKey: currentApiKey,
            model: currentModel,
          },
          getConsoleLogs: () => useSandpackStore.getState().consoleLogs,
          memoryDeps: {
            getAll: () => useMemoryStore.getState().getAll(),
            processBatch: (ops) =>
              useMemoryStore.getState().processBatch(ops),
          },
          filesBridge: {
            getFiles: () => generatorRef.current?.getFiles() ?? {},
            onFilesChanged: (newFiles, changes) => {
              generatorRef.current?.setFiles(newFiles);
              setFiles(newFiles);
              const depsChanged = changes.some(
                (c) =>
                  c.path === "package.json" ||
                  c.path.endsWith("/package.json"),
              );
              if (depsChanged) restartSandpack();
            },
          },
        });

      const dispatchSubagent = runtime.createSubagentDispatcher({
        getApiConfig: () => ({
          apiType: currentApiType,
          apiBaseUrl: currentApiBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
        }),
        getCustomToolSet: () => customToolSet,
        getCombinedToolHandler: () => combinedToolHandler,
      });

      const initialPlanMode =
        useSettingsStore.getState().system.planModeEnabled;
      const initialTools = runtime.buildToolSet({
        custom: customToolSet,
        planMode: initialPlanMode,
      });

      const initialFiles =
        (activeId &&
          useConversationStore.getState().conversations[activeId]?.files) ||
        {};

      generatorRef.current = runtime.createOpenAIGenerator(
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
	            setRunState("streaming");
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
	            setRunState("streaming");
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
	            setRunState(
	              name === "ask_user_question"
	                ? "waitingUser"
	                : name === "exit_plan_mode"
	                  ? "awaitingPlanApproval"
	                  : "executingTool",
	            );
	            flushThinkingBuffer();
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
	            setRunState("completed");
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

            triggerSmartTitle({
              apiType: currentApiType,
              apiBaseUrl: currentApiBaseUrl,
              apiKey: currentApiKey,
              model: currentModel,
            });
          },
	          onError: (error) => {
	            setLastError(classifyGenerationError(error));
	            setRunState("error");
	            console.error("Generation error:", error);
          },
          onRetry: (attempt, maxAttempts, error) => {
            console.warn(
              `Retrying API request (${attempt}/${maxAttempts}):`,
              error.message,
            );
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
            const cfg = getEffectiveAIConfig(
              token,
              settings,
              serverServiceSettings,
            );

            const result = await runtime.runCompress(
              {
                apiType: cfg.apiType,
                apiBaseUrl: cfg.apiBaseUrl,
                apiKey: cfg.apiKey,
                model: cfg.model,
              },
              conv,
            );
            if (!result) return null;
            return getMessagesForAPI({ ...conv, compressedContext: result });
          },
        },
        initialFiles,
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
	            generatorRef.current?.setReadOnlyMode(false);
	            return runtime.buildToolSet({
	              custom: customToolSet,
	              planMode: false,
            });
          },
          dispatchSubagent,
        },
      );

      generatorConfigRef.current = nextConfig;
    }

    return generatorRef.current;
  }, [
    settings,
    webSearchSettings,
    assetSearchSettings,
    serverServiceSettings,
    activeId,
    setMessages,
    setFiles,
    setTemplate,
    setIsProjectInitialized,
    restartSandpack,
    flushThinkingBuffer,
    triggerSmartTitle,
  ]);

  // Apply state that can change between generations: tool set (plan mode toggle),
  // system prompt suffix (memory + plan mode addendum). Called at the start of every run.
  const applyDynamicGeneratorState = useCallback(
    async (generator: WebAppGenerator) => {
      const runtime = await loadGeneratorRuntime();
	      const planMode = useSettingsStore.getState().system.planModeEnabled;
	      const customToolSet = generator.getCustomToolSet();
	      generator.setReadOnlyMode(planMode);
	      generator.setTools(
	        runtime.buildToolSet({ custom: customToolSet, planMode }),
	      );
      const memorySuffix = runtime.buildMemoryPromptSection(
        useMemoryStore.getState().getAll(),
      );
      const skillsSuffix = runtime.buildSkillsPromptSection(
        useSkillsStore.getState().getEnabledSkills(),
      );
      const styleAssetSuffix = buildStyleAssetPromptSection(
        useStyleAssetStore.getState().getEnabledAssets(),
      );
      generator.setSystemPromptSuffix(
        memorySuffix +
          skillsSuffix +
          styleAssetSuffix +
          (planMode ? PLAN_MODE_SYSTEM_SUFFIX : ""),
      );
    },
    [],
  );

  const runAutomaticQa = useCallback(
    async (generator: WebAppGenerator, result: GenerateResult | null) => {
	      const system = useSettingsStore.getState().system;
      if (!system.autoQaEnabled || system.planModeEnabled) return;
      if (!result || result.aborted || result.maxIterationsReached) return;
      if (Object.keys(generator.getFiles()).length === 0) return;

	      await applyDynamicGeneratorState(generator);
	      setRunState("autoQa");
      useInteractiveStore
        .getState()
        .rejectAllPending("automatic QA started");
      setMessages((prev) => [
        ...filterMemoryMessages(prev),
        { role: "user", content: AUTO_QA_PROMPT },
      ]);
      try {
        await generator.generate(AUTO_QA_PROMPT);
      } catch (err: any) {
        if (err?.name === "AbortError") throw err;
        console.error("Automatic QA failed:", err);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Automatic QA failed: ${err?.message || "Unknown error"}`,
            isError: true,
          },
        ]);
      }
    },
    [applyDynamicGeneratorState, setMessages],
  );

  const generate = useCallback(
    async (
      prompt: string,
      attachments?: Attachment[],
      options: GenerateRunOptions = {},
	    ) => {
	      setRunState("preparing");
	      setLastError(null);
	      setIsGenerating(true);
      const runtime = await loadGeneratorRuntime();
      runtime.skillActiveContext.clear();
      await useAuthStore.getState().getValidTokenAsync();

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

      const generator = await getGenerator();
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = storeState.activeId
          ? storeState.conversations[storeState.activeId]
          : null;
        if (activeConv) {
          generator.syncMessages(getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(generator);
      }
      useInteractiveStore
        .getState()
        .rejectAllPending("new generation started");

      setMessages((prev) => [
        ...removeErrorMessages(prev),
        { role: "user", content },
      ]);
      try {
        if (generator) {
          const result = await generator.generate(prompt, attachments);
          if (!options.skipAutoQa) {
            await runAutomaticQa(generator, result);
          }
        }
      } catch (err: any) {
        console.error("Error generating:", err);
        if (err?.name !== "AbortError") {
	          const classified = classifyGenerationError(err);
	          setLastError(classified);
	          setRunState(classified.kind === "aborted" ? "aborted" : "error");
	          setMessages((prev) => [
	            ...removeErrorMessages(prev),
	            {
	              role: "assistant",
	              content: `⚠️ ${classified.message}`,
	              isError: true,
	            },
	          ]);
	        }
	      } finally {
	        setMessages((prev) => filterMemoryMessages(prev));
	        setIsGenerating(false);
	        setRunState((state) =>
	          state === "error" || state === "aborted" ? state : "idle",
	        );
	      }
    },
    [
      getGenerator,
      setIsGenerating,
      setMessages,
      applyDynamicGeneratorState,
      runAutomaticQa,
    ],
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
	    setRunState("aborted");
	    setIsGenerating(false);
    createSnapshotForCurrentState();
  }, [setIsGenerating, setMessages]);

	  const retry = useCallback(async () => {
	    setRunState("preparing");
	    setLastError(null);
	    setIsGenerating(true);
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
      const generator = await getGenerator();
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = storeState.activeId
          ? storeState.conversations[storeState.activeId]
          : null;
        if (activeConv) {
          generator.syncMessages(getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(generator);
        await generator.retry();
      }
    } catch (err: any) {
      console.error("Error retrying:", err);
      if (err?.name !== "AbortError") {
	        const classified = classifyGenerationError(err);
	        setLastError(classified);
	        setRunState(classified.kind === "aborted" ? "aborted" : "error");
	        setMessages((prev) => [
	          ...prev,
	          {
	            role: "assistant",
	            content: `⚠️ ${classified.message}`,
	            isError: true,
	          },
	        ]);
      }
	    } finally {
	      setMessages((prev) => filterMemoryMessages(prev));
	      setIsGenerating(false);
	      setRunState((state) =>
	        state === "error" || state === "aborted" ? state : "idle",
	      );
	    }
  }, [getGenerator, setIsGenerating, setMessages, applyDynamicGeneratorState]);

  const review = useCallback(async () => {
    await generate(
      "Please review all project files for security vulnerabilities. Use list_files and read_files to examine the code. Report any security issues found with severity and location, or confirm no issues were detected. If issues are found, ask if I should fix them automatically.",
      undefined,
      { skipAutoQa: true },
    );
  }, [generate]);

  const healthCheck = useCallback(async () => {
    await generate(
      "Run project_health_check with include_console=true. Summarize the health report by severity, explain the highest-impact issues first, and fix obvious project-breaking errors if they are safe to fix.",
      undefined,
      { skipAutoQa: true },
    );
  }, [generate]);

	  const continueTask = useCallback(async () => {
	    setRunState("preparing");
	    setLastError(null);
	    setIsGenerating(true);
    try {
      const generator = await getGenerator();
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = storeState.activeId
          ? storeState.conversations[storeState.activeId]
          : null;
        if (activeConv) {
          generator.syncMessages(getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(generator);
        await generator.generate(
          "Please continue where you left off and complete any unfinished tasks.",
        );
      }
    } catch (err: any) {
      console.error("Error continuing:", err);
      if (err?.name !== "AbortError") {
	        const classified = classifyGenerationError(err);
	        setLastError(classified);
	        setRunState(classified.kind === "aborted" ? "aborted" : "error");
	        setMessages((prev) => [
	          ...prev,
	          {
	            role: "assistant",
	            content: `⚠️ ${classified.message}`,
	            isError: true,
	          },
	        ]);
      }
	    } finally {
	      setMessages((prev) => filterMemoryMessages(prev));
	      setIsGenerating(false);
	      setRunState((state) =>
	        state === "error" || state === "aborted" ? state : "idle",
	      );
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
	    healthCheck,
	    runState,
	    lastError,
	  };
}
