import type { ToolSet } from "ai";
import { WebAppGenerator } from "../generator";
import type {
  DispatchSubagentResult,
  GeneratorEvents,
  GeneratorOptions,
  ProjectFiles,
} from "../generator-types";
import { BUILTIN_TOOLS, BUILTIN_WRITE_TOOL_NAMES } from "../tools-schema";
import type { ApiType } from "../provider";
import { useSubagentStore } from "../../../store/subagent";
import { useSkillsStore } from "../../../store/skills";
import { filterToolSet } from "../../tools/tool-set-utils";
import { buildSkillsPromptSection } from "../../skills/tool-handler";
import { SKILL_TOOL_NAME_SET } from "../../skills/tools";
import { isSkillsAvailable } from "../../skills/fs";
import {
  SUBAGENT_BUILTIN_TOOL_NAMES,
  getSubagentByName,
} from "./registry";
import type {
  SubagentDefinition,
  SubagentToolResult,
} from "./types";
import {
  SUBAGENT_LIMITS,
  limitSubagentEvents,
  normalizeSubagentTask,
  truncateSubagentText,
} from "./limits";

export interface ParentApiConfig {
  apiType: ApiType;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export interface RunSubagentOpts {
  name: string;
  task: string;
  files: ProjectFiles;
  signal: AbortSignal;
  toolCallId: string;
  parentApiConfig: ParentApiConfig;
  parentCustomToolSet: ToolSet;
  parentCombinedToolHandler: (name: string, args: unknown) => Promise<string>;
}

export interface CreateDispatcherOpts {
  getApiConfig: () => ParentApiConfig;
  getCustomToolSet: () => ToolSet;
  getCombinedToolHandler: () => (
    name: string,
    args: unknown,
  ) => Promise<string>;
}

type WritePolicy = "readonly" | "fullWrite";

function effectiveSubagentWhitelist(
  def: SubagentDefinition,
  policy: WritePolicy,
): Set<string> {
  const whitelist = new Set(def.toolWhitelist);
  if (policy === "readonly") {
    for (const name of BUILTIN_WRITE_TOOL_NAMES) whitelist.delete(name);
  }
  if (isSkillsAvailable()) {
    for (const name of SKILL_TOOL_NAME_SET) whitelist.add(name);
  }
  return whitelist;
}

function buildSubagentToolSet(
  whitelist: ReadonlySet<string>,
  parentCustomToolSet: ToolSet,
): ToolSet {
  const builtins = filterToolSet(
    BUILTIN_TOOLS,
    (name) => SUBAGENT_BUILTIN_TOOL_NAMES.has(name) && whitelist.has(name),
  );
  const customs = filterToolSet(parentCustomToolSet, (name) =>
    whitelist.has(name),
  );
  return { ...builtins, ...customs };
}

function wrapHandlerWithWhitelist(
  parentHandler: (name: string, args: unknown) => Promise<string>,
  whitelist: ReadonlySet<string>,
): (name: string, args: unknown) => Promise<string> {
  return async (name, args) => {
    if (!whitelist.has(name)) {
      return `Error: tool "${name}" is not available to this subagent. Available: ${[...whitelist].join(", ")}.`;
    }
    return parentHandler(name, args);
  };
}

function resolveApiConfig(
  parent: ParentApiConfig,
  override: SubagentDefinition["modelOverride"],
): ParentApiConfig {
  if (!override) return parent;
  return {
    apiType: override.apiType ?? parent.apiType,
    apiBaseUrl: override.apiBaseUrl ?? parent.apiBaseUrl,
    apiKey: override.apiKey ?? parent.apiKey,
    model: override.model ?? parent.model,
  };
}

export async function runSubagent(
  opts: RunSubagentOpts,
): Promise<DispatchSubagentResult> {
  const def = getSubagentByName(opts.name);
  const store = useSubagentStore.getState();
  const checkedTask = normalizeSubagentTask(opts.task);

  if (!def) {
    const failure: SubagentToolResult = {
      ok: false,
      subagent: opts.name,
      task: checkedTask.ok
        ? checkedTask.task
        : truncateSubagentText(opts.task, SUBAGENT_LIMITS.maxTaskChars),
      status: "failed",
      text: "",
      events: [],
      durationMs: 0,
      error: `Unknown subagent "${opts.name}". Pick one of the listed names.`,
    };
    return { text: JSON.stringify(failure) };
  }

  if (!checkedTask.ok) {
    const failure: SubagentToolResult = {
      ok: false,
      subagent: def.name,
      task: "",
      status: "failed",
      text: "",
      events: [],
      durationMs: 0,
      error: checkedTask.error,
    };
    return { text: JSON.stringify(failure) };
  }

  store.init(opts.toolCallId, def.name, checkedTask.task);
  const startedAt = Date.now();

  if (opts.signal.aborted) {
    store.markStatus(opts.toolCallId, "aborted", "Aborted before start");
    const aborted: SubagentToolResult = {
      ok: false,
      subagent: def.name,
      task: checkedTask.task,
      status: "aborted",
      text: "",
      events: [],
      durationMs: 0,
      error: "Aborted before start",
    };
    return { text: JSON.stringify(aborted) };
  }

  const policy: WritePolicy = def.writePolicy ?? "readonly";
  const whitelist = effectiveSubagentWhitelist(def, policy);
  const toolSet = buildSubagentToolSet(whitelist, opts.parentCustomToolSet);
  const wrappedHandler = wrapHandlerWithWhitelist(
    opts.parentCombinedToolHandler,
    whitelist,
  );
  const apiConfig = resolveApiConfig(opts.parentApiConfig, def.modelOverride);

  const enabledSkills = isSkillsAvailable()
    ? useSkillsStore.getState().getEnabledSkills()
    : [];
  const skillsSuffix = buildSkillsPromptSection(enabledSkills);
  const effectiveSystemPrompt = def.systemPrompt + skillsSuffix;

  const events: GeneratorEvents = {
    onText: (delta) => {
      useSubagentStore.getState().appendText(opts.toolCallId, delta);
    },
    onToolCall: (name, innerId) => {
      useSubagentStore.getState().addToolCall(opts.toolCallId, name, innerId);
    },
    onToolResult: (_name, _args, result, innerId) => {
      useSubagentStore
        .getState()
        .setToolResult(opts.toolCallId, innerId, String(result ?? ""));
    },
    onError: () => {
      // Caught by outer try/catch.
    },
  };

  const generatorOptions: GeneratorOptions = {
    apiType: apiConfig.apiType,
    apiBaseUrl: apiConfig.apiBaseUrl,
    apiKey: apiConfig.apiKey,
    model: apiConfig.model,
    systemPrompt: effectiveSystemPrompt,
    initialFiles: opts.files,
    maxIterations: def.maxIterations ?? 10,
    stream: true,
    tools: toolSet,
    customTools: {},
    customToolHandler: wrappedHandler,
    // Subagents do not get user interaction or plan-mode tools.
    thinking: false,
  };

  const inner = new WebAppGenerator(generatorOptions, events);

  const onAbort = () => inner.abort();
  opts.signal.addEventListener("abort", onAbort, { once: true });

  const maxResultLength = def.maxResultLength ?? 4000;

  try {
    const innerResult = await inner.generate(checkedTask.task);
    const finalText = (innerResult.text || "").slice(0, maxResultLength);
    const eventsSnapshot =
      limitSubagentEvents(
        useSubagentStore.getState().progress[opts.toolCallId]?.events ?? [],
      );

    if (innerResult.aborted || opts.signal.aborted) {
      useSubagentStore.getState().markStatus(opts.toolCallId, "aborted");
      const aborted: SubagentToolResult = {
        ok: false,
        subagent: def.name,
        task: checkedTask.task,
        status: "aborted",
        text: finalText,
        events: eventsSnapshot,
        durationMs: Date.now() - startedAt,
        error: "Aborted",
      };
      return { text: JSON.stringify(aborted) };
    }

    useSubagentStore.getState().markStatus(opts.toolCallId, "done");
    const result: SubagentToolResult = {
      ok: true,
      subagent: def.name,
      task: checkedTask.task,
      status: "done",
      text: finalText,
      events: eventsSnapshot,
      durationMs: Date.now() - startedAt,
    };
    return {
      text: JSON.stringify(result),
      // Only propagate files for write-capable subagents. Readonly subagents'
      // inner files cannot diverge from the parent's, so skip the work.
      files: policy === "fullWrite" ? inner.getFiles() : undefined,
    };
  } catch (err) {
    const isAbort =
      (err as { name?: string })?.name === "AbortError" || opts.signal.aborted;
    const status = isAbort ? "aborted" : "failed";
    const message =
      (err as { message?: string })?.message ?? "Unknown subagent error";
    const eventsSnapshot =
      limitSubagentEvents(
        useSubagentStore.getState().progress[opts.toolCallId]?.events ?? [],
      );
    const textSnapshot =
      useSubagentStore.getState().progress[opts.toolCallId]?.text ?? "";
    useSubagentStore
      .getState()
      .markStatus(opts.toolCallId, status, isAbort ? undefined : message);
    const failure: SubagentToolResult = {
      ok: false,
      subagent: def.name,
      task: checkedTask.task,
      status,
      text: textSnapshot.slice(0, maxResultLength),
      events: eventsSnapshot,
      durationMs: Date.now() - startedAt,
      error: isAbort
        ? "Aborted"
        : truncateSubagentText(message, SUBAGENT_LIMITS.maxErrorChars),
    };
    return { text: JSON.stringify(failure) };
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }
}

export function createSubagentDispatcher(
  opts: CreateDispatcherOpts,
): NonNullable<GeneratorOptions["dispatchSubagent"]> {
  return (name, task, files, signal, toolCallId) =>
    runSubagent({
      name,
      task,
      files,
      signal,
      toolCallId,
      parentApiConfig: opts.getApiConfig(),
      parentCustomToolSet: opts.getCustomToolSet(),
      parentCombinedToolHandler: opts.getCombinedToolHandler(),
    });
}
