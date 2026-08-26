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
  Conversation,
  ProjectFiles,
  AISettings,
  WebSearchSettings,
  AssetSearchSettings,
  Attachment,
  GeneratorRunState,
  StructuredGenerationError,
} from "../types";
import { useMemoryStore } from "../store/memory";
import { useFileOperations } from "./useFileOperations";
import { useTitleAndCompression } from "./useTitleAndCompression";
import {
  classifyGenerationError,
  formatGenerationErrorMessage,
} from "../lib/ai/generation-error";
import { isGenerationRunCurrent } from "../lib/ai/run-guard";
import { getT } from "../i18n";
import type { McpRuntimeBundle } from "../lib/mcp/runtime";
import type { ExecutionMode, RuntimePlatform } from "../lib/ai/tools-schema";
import { TOOL_POLICY_VERSION } from "../lib/ai/tool-policy-version";
import { getSkillRegistry } from "../lib/skills/instance";
import {
  hydrateMessageAttachments,
  resolveAttachmentsForModel,
  toAttachmentRef,
} from "../lib/attachments/store";
import { recordPermissionActivity } from "../lib/security/activity-log";
import {
  sanitizeToolExecutionOutputForHistory,
  sanitizeToolResultForHistory,
  serializeToolArgumentsForHistory,
} from "../lib/utils/message-security";
import {
  isErrorMessage,
  messagesForConversationContinuation,
  removeErrorMessages,
} from "../lib/ai/conversation-context";

interface GeneratorConfigSnapshot {
  apiType: AISettings["apiType"];
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  searchEngine: string;
  tavilyKey: string;
  firecrawlKey: string;
  assetEngine: string;
  pixabayKey: string;
  unsplashKey: string;
  toolPolicyVersion: string;
  developerSkillScriptsEnabled: boolean;
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
    a.tavilyKey === b.tavilyKey &&
    a.firecrawlKey === b.firecrawlKey &&
    a.assetEngine === b.assetEngine &&
    a.pixabayKey === b.pixabayKey &&
    a.unsplashKey === b.unsplashKey &&
    a.toolPolicyVersion === b.toolPolicyVersion &&
    a.developerSkillScriptsEnabled === b.developerSkillScriptsEnabled
  );
}

function getLastForcedSkillIds(messages: readonly Message[]): string[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && message.metadata?.origin !== "auto_qa") {
      return message.forcedSkillIds ?? [];
    }
  }
  return [];
}

/** Apply compression and hydrate attachment references only for model input. */
async function getMessagesForAPI(conv: Conversation): Promise<Message[]> {
  return hydrateMessageAttachments(messagesForConversationContinuation(conv));
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

interface GenerateRunOptions {
  skipAutoQa?: boolean;
  forcedSkillIds?: string[];
}

interface GeneratorRuntime {
  createOpenAIGenerator: typeof import("../lib/ai/client").createOpenAIGenerator;
  buildToolHandlers: typeof import("../lib/tools/handler-factory").buildToolHandlers;
  createSubagentDispatcher: typeof import("../lib/ai/subagents/runner").createSubagentDispatcher;
  runCompress: typeof import("../lib/utils/run-compress").runCompress;
  buildMemoryPromptSection: typeof import("../lib/tools/memory").buildMemoryPromptSection;
  buildSkillsPromptSection: typeof import("../lib/skills/tool-handler").buildSkillsPromptSection;
  buildForcedSkillsPromptSection: typeof import("../lib/skills/tool-handler").buildForcedSkillsPromptSection;
  getSkillRegistry: typeof import("../lib/skills/instance").getSkillRegistry;
  isSkillsAvailable: typeof import("../lib/skills/fs").isSkillsAvailable;
  mcpManager: ReturnType<
    typeof import("../lib/mcp/connection-manager").getMcpConnectionManager
  >;
  buildToolSet: (args: {
    custom: ToolSet;
    planMode: boolean;
    mode?: ExecutionMode;
    runtimePlatform: RuntimePlatform;
    allowedDynamicNames?: ReadonlySet<string>;
  }) => ToolSet;
}

let generatorRuntimePromise: Promise<GeneratorRuntime> | null = null;

function loadGeneratorRuntime(): Promise<GeneratorRuntime> {
  generatorRuntimePromise ??= Promise.all([
    import("../lib/ai/client"),
    import("../lib/ai/tools-schema"),
    import("../lib/tools/memory"),
    import("../lib/tools/handler-factory"),
    import("../lib/ai/subagents/runner"),
    import("../lib/utils/run-compress"),
    import("../lib/skills/tool-handler"),
    import("../lib/skills/fs"),
    import("../lib/mcp/connection-manager"),
  ]).then(
    ([
      client,
      toolsSchema,
      memory,
      handlerFactory,
      subagentRunner,
      runCompressModule,
      skillToolHandler,
      skillFs,
      mcpConnectionManager,
    ]) => {
      const buildToolSet = ({
        custom,
        planMode,
        mode = planMode ? "plan" : "chat",
        runtimePlatform,
        allowedDynamicNames = new Set(),
      }: {
        custom: ToolSet;
        planMode: boolean;
        mode?: ExecutionMode;
        runtimePlatform: RuntimePlatform;
        allowedDynamicNames?: ReadonlySet<string>;
      }): ToolSet =>
        toolsSchema.buildToolSetForRun({
          custom,
          mode,
          platform: runtimePlatform,
          allowedDynamicNames,
        });

      return {
        createOpenAIGenerator: client.createOpenAIGenerator,
        buildToolHandlers: handlerFactory.buildToolHandlers,
        createSubagentDispatcher: subagentRunner.createSubagentDispatcher,
        runCompress: runCompressModule.runCompress,
        buildMemoryPromptSection: memory.buildMemoryPromptSection,
        buildSkillsPromptSection: skillToolHandler.buildSkillsPromptSection,
        buildForcedSkillsPromptSection:
          skillToolHandler.buildForcedSkillsPromptSection,
        getSkillRegistry,
        isSkillsAvailable: skillFs.isSkillsAvailable,
        mcpManager: mcpConnectionManager.getMcpConnectionManager(),
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
  setMessages,
  setFiles,
  setIsGenerating,
  setTemplate,
  restartSandpack,
  setIsProjectInitialized,
}: UseGeneratorOptions) {
  const generatorRef = useRef<WebAppGenerator | null>(null);
  const [runState, setRunState] = useState<GeneratorRunState>("idle");
  const [lastError, setLastError] = useState<StructuredGenerationError | null>(
    null,
  );
  const generatorConfigRef = useRef<GeneratorConfigSnapshot | null>(null);
  const activeId = useConversationStore((s) => s.activeId);
  const prevActiveIdRef = useRef(activeId);
  const textBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const typewriterTimerRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);
  const lastCharTimeRef = useRef(0);
  const lastThinkingTimeRef = useRef(0);
  const runConversationIdRef = useRef<string | null>(null);
  const forcedSkillsPromptRef = useRef("");
  const trustedSkillsPromptRef = useRef("");
  const baseCustomToolSetRef = useRef<ToolSet>({});
  const mcpRuntimeRef = useRef<McpRuntimeBundle | null>(null);

  const clearOutputBuffers = useCallback(() => {
    if (typewriterTimerRef.current) {
      cancelAnimationFrame(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    if (thinkingTimerRef.current) {
      cancelAnimationFrame(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    textBufferRef.current = "";
    thinkingBufferRef.current = "";
  }, []);

  const isCurrentGeneratorRun = useCallback(
    (runConversationId: string | null) =>
      isGenerationRunCurrent(
        runConversationId,
        useConversationStore.getState().activeId,
        runConversationIdRef.current,
      ),
    [],
  );

  useEffect(
    () => () => {
      clearOutputBuffers();
      forcedSkillsPromptRef.current = "";
      trustedSkillsPromptRef.current = "";
      mcpRuntimeRef.current = null;
      generatorRef.current?.abort();
    },
    [clearOutputBuffers],
  );

  const invalidateGenerator = useCallback(() => {
    generatorRef.current?.abort();
    generatorRef.current = null;
    generatorConfigRef.current = null;
    runConversationIdRef.current = null;
    forcedSkillsPromptRef.current = "";
    trustedSkillsPromptRef.current = "";
    baseCustomToolSetRef.current = {};
    mcpRuntimeRef.current = null;
    clearOutputBuffers();
    useInteractiveStore.getState().rejectAllPending("project reset");
    useSubagentStore.setState({ progress: {} });
  }, [clearOutputBuffers]);

  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return;
    generatorRef.current?.abort();
    generatorRef.current = null;
    generatorConfigRef.current = null;
    runConversationIdRef.current = null;
    forcedSkillsPromptRef.current = "";
    trustedSkillsPromptRef.current = "";
    baseCustomToolSetRef.current = {};
    mcpRuntimeRef.current = null;
    clearOutputBuffers();
    prevActiveIdRef.current = activeId;
    useInteractiveStore.getState().rejectAllPending("conversation switched");
    useSubagentStore.setState({ progress: {} });
    setIsGenerating(false);
    setRunState("idle");
  }, [activeId, clearOutputBuffers, setIsGenerating]);

  const { updateFiles, deleteFile, renameFile, moveFile } = useFileOperations({
    setFiles,
    generatorRef,
  });

  const resolveEffectiveConfig = useCallback(async () => {
    return {
      apiType: settings.apiType,
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    };
  }, [settings]);

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

  const flushTextBuffer = useCallback(() => {
    if (typewriterTimerRef.current) {
      cancelAnimationFrame(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    if (!textBufferRef.current) return;
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
              ((typeof last.content === "string" ? last.content : "") || "") +
              remainingText,
          },
        ];
      }
      return prev;
    });
  }, [setMessages]);

  const flushOutputBuffers = useCallback(() => {
    flushThinkingBuffer();
    flushTextBuffer();
  }, [flushThinkingBuffer, flushTextBuffer]);

  const appendGenerationError = useCallback(
    (
      err: unknown,
      options: { replaceExisting?: boolean } = {},
    ): StructuredGenerationError => {
      flushOutputBuffers();
      const classified = classifyGenerationError(err);
      setLastError(classified);
      setRunState(classified.kind === "aborted" ? "aborted" : "error");
      setMessages((prev) => [
        ...(options.replaceExisting ? removeErrorMessages(prev) : prev),
        {
          role: "assistant",
          content: formatGenerationErrorMessage(classified, getT()),
          isError: true,
          errorKind: classified.kind,
          errorRetryable: classified.retryable,
          ...(classified.status !== undefined
            ? { errorStatus: classified.status }
            : {}),
        },
      ]);
      return classified;
    },
    [flushOutputBuffers, setMessages],
  );

  const getGenerator = useCallback(async () => {
    const currentApiType = settings.apiType;
    const currentApiKey = settings.apiKey;
    const currentApiBaseUrl = settings.apiBaseUrl;
    const currentModel = settings.model;

    if (!settings.apiKey || !settings.apiBaseUrl || !settings.model)
      return null;

    const currentSearchEngine = webSearchSettings.engine;
    const currentAssetEngine = assetSearchSettings.engine;

    // Invalidate on conversation switch
    if (prevActiveIdRef.current !== activeId) {
      generatorRef.current?.abort();
      generatorRef.current = null;
      generatorConfigRef.current = null;
      runConversationIdRef.current = null;
      baseCustomToolSetRef.current = {};
      mcpRuntimeRef.current = null;
      clearOutputBuffers();
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
      tavilyKey: webSearchSettings.tavilyApiKey,
      firecrawlKey: webSearchSettings.firecrawlApiKey,
      assetEngine: currentAssetEngine,
      pixabayKey: assetSearchSettings.pixabayApiKey,
      unsplashKey: assetSearchSettings.unsplashApiKey,
      toolPolicyVersion: TOOL_POLICY_VERSION,
      developerSkillScriptsEnabled:
        useSettingsStore.getState().system.developerSkillScriptsEnabled,
    };

    if (
      generatorRef.current &&
      !sameGeneratorConfig(generatorConfigRef.current, nextConfig)
    ) {
      generatorRef.current.abort();
      generatorRef.current = null;
      generatorConfigRef.current = null;
      baseCustomToolSetRef.current = {};
      mcpRuntimeRef.current = null;
    }

    if (!generatorRef.current) {
      const runtime = await loadGeneratorRuntime();
      const generatorConversationId = activeId;
      const isBuiltinSearch = webSearchSettings.engine === "builtin";
      const webConfigured =
        !isBuiltinSearch && useSettingsStore.getState().isWebSearchConfigured();
      const assetConfigured = useSettingsStore
        .getState()
        .isAssetSearchConfigured();

      const {
        customToolSet,
        combinedToolHandler,
        providerToolNames,
        runtimePlatform,
      } = await runtime.buildToolHandlers({
        features: {
          builtinSearch: isBuiltinSearch,
          webSearch: webConfigured,
          assetSearch: assetConfigured,
        },
        effectiveWebSearchSettings: webSearchSettings,
        effectiveAssetSearchSettings: assetSearchSettings,
        apiConfig: {
          apiType: currentApiType,
          apiBaseUrl: currentApiBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
        },
        getConsoleLogs: () => useSandpackStore.getState().consoleLogs,
        memoryDeps: {
          getAll: () => useMemoryStore.getState().getAll(),
          processBatch: (ops) => useMemoryStore.getState().processBatch(ops),
        },
        developerSkillScriptsEnabled:
          useSettingsStore.getState().system.developerSkillScriptsEnabled,
        requestRegistryOriginApproval: async (origin, context) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return false;
          const translations = getT();
          recordPermissionActivity({
            tool: "install_component",
            source: "registry",
            mode: context.run.mode,
            platform: context.run.platform,
            decision: "requested",
            target: origin,
          });
          const answers = await useInteractiveStore.getState().askQuestion({
            toolCallId: context.toolCallId,
            questions: [
              {
                header: translations.approvals.registryHeader,
                question: translations.approvals.registryQuestion.replace(
                  "{origin}",
                  origin,
                ),
                multiSelect: false,
                options: [
                  {
                    label: translations.approvals.approveOnce,
                    description: translations.approvals.approveOnceDesc,
                  },
                  {
                    label: translations.approvals.deny,
                    description: translations.approvals.denyDesc,
                  },
                ],
              },
            ],
          });
          const approved = answers.answers[0]?.selected.includes(
            translations.approvals.approveOnce,
          );
          recordPermissionActivity({
            tool: "install_component",
            source: "registry",
            mode: context.run.mode,
            platform: context.run.platform,
            decision: approved ? "allowed" : "denied",
            target: origin,
            reason: approved ? undefined : "user denied custom registry origin",
          });
          return approved;
        },
        filesBridge: {
          getFiles: () =>
            isCurrentGeneratorRun(generatorConversationId)
              ? (generatorRef.current?.getFiles() ?? {})
              : {},
          onFilesChanged: (newFiles, changes) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            generatorRef.current?.setFiles(newFiles);
            setFiles(newFiles);
            const depsChanged = changes.some(
              (c) =>
                c.path === "package.json" || c.path.endsWith("/package.json"),
            );
            if (depsChanged) restartSandpack();
          },
        },
      });

      baseCustomToolSetRef.current = customToolSet;
      const combinedToolHandlerWithMcp: typeof combinedToolHandler = async (
        name,
        args,
        context,
      ) => {
        const mcpRuntime = mcpRuntimeRef.current;
        if (mcpRuntime?.aliases.has(name)) {
          return mcpRuntime.handler(name, args, context);
        }
        return combinedToolHandler(name, args, context);
      };

      const dispatchSubagent = runtime.createSubagentDispatcher({
        getApiConfig: () => ({
          apiType: currentApiType,
          apiBaseUrl: currentApiBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
        }),
        getCustomToolSet: () =>
          generatorRef.current?.getCustomToolSet() ?? customToolSet,
        getCombinedToolHandler: () => combinedToolHandlerWithMcp,
        getForcedSkillsPrompt: () => forcedSkillsPromptRef.current,
        getSkillContextSnapshot: () =>
          generatorRef.current?.getSkillContext().snapshot() ?? null,
        getAdditionalToolNames: () =>
          mcpRuntimeRef.current?.subagentToolNames ?? new Set(),
      });

      const initialPlanMode =
        useSettingsStore.getState().system.planModeEnabled;
      const initialTools = runtime.buildToolSet({
        custom: customToolSet,
        planMode: initialPlanMode,
        runtimePlatform,
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
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            setRunState("streaming");
            flushThinkingBuffer();
            textBufferRef.current += delta;
            if (!typewriterTimerRef.current) {
              const typeChar = (timestamp: number) => {
                if (!isCurrentGeneratorRun(generatorConversationId)) {
                  textBufferRef.current = "";
                  typewriterTimerRef.current = null;
                  return;
                }
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
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            setRunState("streaming");
            thinkingBufferRef.current += delta;
            if (!thinkingTimerRef.current) {
              const typeThinking = (timestamp: number) => {
                if (!isCurrentGeneratorRun(generatorConversationId)) {
                  thinkingBufferRef.current = "";
                  thinkingTimerRef.current = null;
                  return;
                }
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
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
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
          onToolResult: (_name, _args, result, _toolCallId, output) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            const persistedArguments = serializeToolArgumentsForHistory(
              _name,
              _args,
            );
            const persistedResult = sanitizeToolResultForHistory(
              _name,
              _args,
              result,
            );
            const persistedOutput = sanitizeToolExecutionOutputForHistory(
              _name,
              _args,
              output,
            );
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
                        arguments: persistedArguments,
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
                        content: persistedResult,
                        tool_call_id: toolCall.id,
                        ...(persistedOutput
                          ? { toolOutput: persistedOutput }
                          : {}),
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
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            setFiles(newFiles);
          },
          onTemplateChange: (tmpl, newFiles) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            setTemplate(tmpl);
            setFiles(newFiles);
            setIsProjectInitialized(true);
            restartSandpack();
          },
          onDependenciesChange: (newFiles) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            setFiles(newFiles);
            restartSandpack();
          },
          onComplete: () => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
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
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            setLastError(classifyGenerationError(error));
            setRunState("error");
            console.error("Generation error:", error);
          },
          onRetry: (attempt, maxAttempts, error) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
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
            if (!isCurrentGeneratorRun(generatorConversationId)) return null;
            const s = useConversationStore.getState();
            const conv = generatorConversationId
              ? s.conversations[generatorConversationId]
              : null;
            if (!conv) return null;

            const result = await runtime.runCompress(
              {
                apiType: settings.apiType,
                apiBaseUrl: settings.apiBaseUrl,
                apiKey: settings.apiKey,
                model: settings.model,
              },
              conv,
            );
            if (!isCurrentGeneratorRun(generatorConversationId)) return null;
            if (!result) return null;
            return getMessagesForAPI({ ...conv, compressedContext: result });
          },
        },
        initialFiles,
        customToolSet,
        combinedToolHandlerWithMcp,
        {
          tools: initialTools,
          askUserQuestion: (toolCallId, questions) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) {
              return Promise.reject(
                new DOMException("conversation switched", "AbortError"),
              );
            }
            return useInteractiveStore.getState().askQuestion({
              toolCallId,
              questions,
            });
          },
          requestPlanApproval: (toolCallId, plan) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) {
              return Promise.reject(
                new DOMException("conversation switched", "AbortError"),
              );
            }
            return useInteractiveStore.getState().askPlanApproval({
              toolCallId,
              plan,
            });
          },
          onPlanApproved: async () => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            const { system, setSystem } = useSettingsStore.getState();
            if (system.planModeEnabled) {
              setSystem({ ...system, planModeEnabled: false });
            }
            generatorRef.current?.setReadOnlyMode(false);
            generatorRef.current?.setExecutionMode("chat");
            const mcpRuntime = await runtime.mcpManager.prepareRuntime();
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            mcpRuntimeRef.current = mcpRuntime;
            const custom = {
              ...baseCustomToolSetRef.current,
              ...mcpRuntime.tools,
            };
            generatorRef.current?.setCustomToolSet(custom);
            generatorRef.current?.setAllowedMcpAliases(
              new Set(mcpRuntime.aliases.keys()),
            );
            generatorRef.current?.setUntrustedReferenceContext(
              mcpRuntime.instructions,
            );
            generatorRef.current?.setSystemPromptSuffix(
              runtime.buildMemoryPromptSection(
                useMemoryStore.getState().getAll(),
              ) + trustedSkillsPromptRef.current,
            );
            return runtime.buildToolSet({
              custom,
              planMode: false,
              runtimePlatform,
              allowedDynamicNames: new Set(mcpRuntime.aliases.keys()),
            });
          },
          dispatchSubagent: async (...args) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) {
              throw new DOMException("conversation switched", "AbortError");
            }
            return dispatchSubagent(...args);
          },
          runtimePlatform,
        },
      );

      generatorConfigRef.current = nextConfig;
    }

    return generatorRef.current;
  }, [
    settings,
    webSearchSettings,
    assetSearchSettings,
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
    async (
      generator: WebAppGenerator,
      forcedSkillIds: readonly string[] = [],
      dynamicOptions: {
        includeMcp?: boolean;
        mode?: ExecutionMode;
      } = {},
    ) => {
      const runtime = await loadGeneratorRuntime();
      const planMode = useSettingsStore.getState().system.planModeEnabled;
      const mode = dynamicOptions.mode ?? (planMode ? "plan" : "chat");
      const mcpRuntime = await runtime.mcpManager.prepareRuntime({
        includeMcp: mode === "auto_qa" ? false : dynamicOptions.includeMcp,
      });
      mcpRuntimeRef.current =
        dynamicOptions.includeMcp === false ? null : mcpRuntime;
      const customToolSet = {
        ...baseCustomToolSetRef.current,
        ...mcpRuntime.tools,
      };
      generator.setCustomToolSet(customToolSet);
      generator.setExecutionMode(mode);
      generator.setAllowedMcpAliases(
        mode === "chat"
          ? new Set(mcpRuntime.aliases.keys())
          : mode === "plan"
            ? mcpRuntime.planModeToolNames
            : new Set(),
      );
      generator.setTools(
        runtime.buildToolSet({
          custom: customToolSet,
          planMode: mode === "plan",
          mode,
          runtimePlatform: generator.getRunContext().platform,
          allowedDynamicNames:
            mode === "chat"
              ? new Set(mcpRuntime.aliases.keys())
              : mode === "plan"
                ? mcpRuntime.planModeToolNames
                : new Set(),
        }),
      );
      if (mcpRuntime.warnings.length > 0) {
        console.warn("Some MCP servers are unavailable:", mcpRuntime.warnings);
      }
      const memorySuffix =
        mode === "chat"
          ? runtime.buildMemoryPromptSection(useMemoryStore.getState().getAll())
          : "";
      const skillContext = generator.getSkillContext();
      skillContext.clear();
      let skillsSuffix = "";
      let forcedSkillsSuffix = "";
      if ((mode === "chat" || mode === "plan") && runtime.isSkillsAvailable()) {
        const registry = await runtime.getSkillRegistry();
        skillsSuffix = runtime.buildSkillsPromptSection(
          registry.getAutoEnabled(),
        );
        const prepared = await registry.prepareForcedSkills(forcedSkillIds);
        skillContext.activateMany(prepared.map((skill) => skill.entry));
        forcedSkillsSuffix = runtime.buildForcedSkillsPromptSection(prepared);
      } else if (forcedSkillIds.length > 0) {
        throw new Error(
          "Forced skills cannot be loaded because skill storage is unavailable.",
        );
      }
      forcedSkillsPromptRef.current = forcedSkillsSuffix;
      trustedSkillsPromptRef.current = skillsSuffix + forcedSkillsSuffix;
      generator.setUntrustedReferenceContext(
        mode === "auto_qa" ? "" : mcpRuntime.instructions,
      );
      generator.setSystemPromptSuffix(
        memorySuffix +
          trustedSkillsPromptRef.current +
          (mode === "plan" ? PLAN_MODE_SYSTEM_SUFFIX : ""),
      );
    },
    [],
  );

  const runAutomaticQa = useCallback(
    async (generator: WebAppGenerator, result: GenerateResult | null) => {
      const runConversationId = runConversationIdRef.current;
      if (!isCurrentGeneratorRun(runConversationId)) return;
      const system = useSettingsStore.getState().system;
      if (!system.autoQaEnabled || system.planModeEnabled) return;
      if (!result || result.aborted || result.maxIterationsReached) return;
      if (Object.keys(generator.getFiles()).length === 0) return;

      await applyDynamicGeneratorState(generator, [], {
        includeMcp: false,
        mode: "auto_qa",
      });
      if (!isCurrentGeneratorRun(runConversationId)) return;
      setRunState("autoQa");
      useInteractiveStore.getState().rejectAllPending("automatic QA started");
      setMessages((prev) => [
        ...filterMemoryMessages(prev),
        {
          role: "user",
          content: AUTO_QA_PROMPT,
          metadata: { origin: "auto_qa" },
        },
      ]);
      try {
        await generator.generate(AUTO_QA_PROMPT);
      } catch (err: any) {
        if (err?.name === "AbortError") throw err;
        if (!isCurrentGeneratorRun(runConversationId)) return;
        console.error("Automatic QA failed:", err);
        appendGenerationError(
          new Error(`Automatic QA failed: ${err?.message || "Unknown error"}`),
        );
      }
    },
    [
      applyDynamicGeneratorState,
      appendGenerationError,
      isCurrentGeneratorRun,
      setMessages,
    ],
  );

  const generate = useCallback(
    async (
      prompt: string,
      attachments?: Attachment[],
      options: GenerateRunOptions = {},
    ) => {
      const runConversationId = useConversationStore.getState().activeId;
      if (!runConversationId) return;
      runConversationIdRef.current = runConversationId;
      setRunState("preparing");
      setLastError(null);
      setIsGenerating(true);

      const content = prompt;
      const attachmentRefs = attachments?.map(toAttachmentRef) ?? [];

      let userMessageAdded = false;
      try {
        const resolvedAttachments = attachments?.length
          ? await resolveAttachmentsForModel(attachments)
          : undefined;
        const generator = await getGenerator();
        if (!isCurrentGeneratorRun(runConversationId)) return;
        if (generator) {
          const storeState = useConversationStore.getState();
          const activeConv = runConversationId
            ? storeState.conversations[runConversationId]
            : null;
          if (activeConv) {
            generator.syncMessages(await getMessagesForAPI(activeConv));
          }
          await applyDynamicGeneratorState(
            generator,
            options.forcedSkillIds ?? [],
          );
        }
        if (!isCurrentGeneratorRun(runConversationId)) return;
        useInteractiveStore
          .getState()
          .rejectAllPending("new generation started");

        setMessages((prev) => [
          ...removeErrorMessages(prev),
          {
            role: "user",
            content,
            forcedSkillIds: options.forcedSkillIds,
            ...(attachmentRefs.length > 0
              ? { metadata: { attachments: attachmentRefs } }
              : {}),
          },
        ]);
        userMessageAdded = true;
        if (generator) {
          const result = await generator.generate(prompt, resolvedAttachments);
          if (!options.skipAutoQa) {
            await runAutomaticQa(generator, result);
          }
        }
      } catch (err: any) {
        if (!isCurrentGeneratorRun(runConversationId)) return;
        if (!userMessageAdded) {
          setMessages((prev) => [
            ...removeErrorMessages(prev),
            {
              role: "user",
              content,
              forcedSkillIds: options.forcedSkillIds,
              ...(attachmentRefs.length > 0
                ? { metadata: { attachments: attachmentRefs } }
                : {}),
            },
          ]);
        }
        console.error("Error generating:", err);
        if (err?.name !== "AbortError") {
          appendGenerationError(err, { replaceExisting: true });
        }
      } finally {
        if (isCurrentGeneratorRun(runConversationId)) {
          setMessages((prev) => filterMemoryMessages(prev));
          setIsGenerating(false);
          setRunState((state) =>
            state === "error" || state === "aborted" ? state : "idle",
          );
          forcedSkillsPromptRef.current = "";
          runConversationIdRef.current = null;
        }
      }
    },
    [
      getGenerator,
      setIsGenerating,
      setMessages,
      applyDynamicGeneratorState,
      runAutomaticQa,
      appendGenerationError,
      isCurrentGeneratorRun,
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
    forcedSkillsPromptRef.current = "";
    runConversationIdRef.current = null;
    useInteractiveStore.getState().rejectAllPending("user stopped");
    setRunState("aborted");
    setIsGenerating(false);
    createSnapshotForCurrentState();
  }, [setIsGenerating, setMessages]);

  const retry = useCallback(async () => {
    const runConversationId = useConversationStore.getState().activeId;
    if (!runConversationId) return;
    runConversationIdRef.current = runConversationId;
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
      if (!isCurrentGeneratorRun(runConversationId)) return;
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = runConversationId
          ? storeState.conversations[runConversationId]
          : null;
        if (activeConv) {
          generator.syncMessages(await getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(
          generator,
          getLastForcedSkillIds(activeConv?.messages ?? []),
        );
        if (!isCurrentGeneratorRun(runConversationId)) return;
        await generator.retry();
      }
    } catch (err: any) {
      if (!isCurrentGeneratorRun(runConversationId)) return;
      console.error("Error retrying:", err);
      if (err?.name !== "AbortError") {
        appendGenerationError(err);
      }
    } finally {
      if (isCurrentGeneratorRun(runConversationId)) {
        setMessages((prev) => filterMemoryMessages(prev));
        setIsGenerating(false);
        setRunState((state) =>
          state === "error" || state === "aborted" ? state : "idle",
        );
        forcedSkillsPromptRef.current = "";
        runConversationIdRef.current = null;
      }
    }
  }, [
    getGenerator,
    setIsGenerating,
    setMessages,
    applyDynamicGeneratorState,
    appendGenerationError,
    isCurrentGeneratorRun,
  ]);

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
    const runConversationId = useConversationStore.getState().activeId;
    if (!runConversationId) return;
    runConversationIdRef.current = runConversationId;
    setRunState("preparing");
    setLastError(null);
    setIsGenerating(true);
    try {
      const generator = await getGenerator();
      if (!isCurrentGeneratorRun(runConversationId)) return;
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = runConversationId
          ? storeState.conversations[runConversationId]
          : null;
        if (activeConv) {
          generator.syncMessages(await getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(generator);
        if (!isCurrentGeneratorRun(runConversationId)) return;
        await generator.generate(
          "Please continue where you left off and complete any unfinished tasks.",
        );
      }
    } catch (err: any) {
      if (!isCurrentGeneratorRun(runConversationId)) return;
      console.error("Error continuing:", err);
      if (err?.name !== "AbortError") {
        appendGenerationError(err);
      }
    } finally {
      if (isCurrentGeneratorRun(runConversationId)) {
        setMessages((prev) => filterMemoryMessages(prev));
        setIsGenerating(false);
        setRunState((state) =>
          state === "error" || state === "aborted" ? state : "idle",
        );
        forcedSkillsPromptRef.current = "";
        runConversationIdRef.current = null;
      }
    }
  }, [
    getGenerator,
    setIsGenerating,
    setMessages,
    applyDynamicGeneratorState,
    appendGenerationError,
    isCurrentGeneratorRun,
  ]);

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
    invalidateGenerator,
    runState,
    lastError,
  };
}
