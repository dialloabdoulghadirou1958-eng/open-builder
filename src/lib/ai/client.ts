import {
  WebAppGenerator,
  GeneratorOptions,
  GeneratorEvents,
  ProjectFiles,
} from "./generator";
import type { ToolSet } from "ai";
import type { ApiType } from "./provider";

export interface OpenAIClientConfig {
  apiType?: ApiType;
  apiBaseUrl?: string;
  apiKey: string;
  model?: string;
  stream?: boolean;
  providerToolNames?: string[];
}

export function createOpenAIGenerator(
  config: OpenAIClientConfig,
  events?: GeneratorEvents,
  initialFiles?: ProjectFiles,
  customTools?: ToolSet,
  customToolHandler?: (name: string, args: unknown) => string | Promise<string>,
  extras?: Pick<
    GeneratorOptions,
    | "tools"
    | "askUserQuestion"
    | "requestPlanApproval"
    | "onPlanApproved"
    | "dispatchSubagent"
  >,
): WebAppGenerator {
  const options: GeneratorOptions = {
    apiType: config.apiType ?? "openai-compatible",
    apiBaseUrl: config.apiBaseUrl || "https://api.openai.com",
    apiKey: config.apiKey,
    model: config.model || "gpt-5.3-codex",
    stream: config.stream ?? true,
    initialFiles,
    customTools,
    customToolHandler,
    providerToolNames: config.providerToolNames,
    ...(extras ?? {}),
  };

  return new WebAppGenerator(options, events);
}
