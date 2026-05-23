import {
  WebAppGenerator,
  GeneratorOptions,
  GeneratorEvents,
  ProjectFiles,
} from "./generator";
import type { ToolSet } from "ai";
import type { ApiType } from "./ai-provider";

/**
 * OpenAI 兼容客户端配置
 */
export interface OpenAIClientConfig {
  /** API 类型 */
  apiType?: ApiType;
  /** API 基础地址 */
  apiBaseUrl?: string;
  /** API 密钥 */
  apiKey: string;
  /** 模型名称 */
  model?: string;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** Names of provider-managed tools (executed server-side, not locally) */
  providerToolNames?: string[];
}

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/**
 * 根据 API Base URL 构建完整请求 URL
 * 如果 baseUrl 已经以 /v{数字} 结尾，则只拼接 path 部分（不再添加 /v1）
 */
export function buildApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (/\/v\d+$/.test(base)) {
    return `${base}${path}`;
  }
  return `${base}/v1${path}`;
}

/**
 * 创建 OpenAI 兼容的 Web App 生成器
 */
export function createOpenAIGenerator(
  config: OpenAIClientConfig,
  events?: GeneratorEvents,
  initialFiles?: ProjectFiles,
  customTools?: ToolSet,
  customToolHandler?: (name: string, args: unknown) => string | Promise<string>,
  extras?: Pick<
    GeneratorOptions,
    "tools" | "askUserQuestion" | "requestPlanApproval" | "onPlanApproved"
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

/**
 * 简化的生成函数 - 用于单次代码生成
 */
export async function generateWithOpenAI(
  prompt: string,
  config: OpenAIClientConfig,
  currentFiles?: ProjectFiles,
): Promise<{ code: string; files: ProjectFiles }> {
  let generatedText = "";
  let finalFiles: ProjectFiles = {};

  const generator = createOpenAIGenerator(
    config,
    {
      onText: (delta) => {
        generatedText += delta;
      },
      onFileChange: (files) => {
        finalFiles = files;
      },
      onError: (error) => {
        console.error("Generation error:", error);
      },
    },
    currentFiles,
  );

  await generator.generate(prompt);

  // 如果有 App.tsx 文件，返回其内容作为主代码
  const mainCode = finalFiles["src/App.tsx"] || finalFiles["App.tsx"] || "";

  return {
    code: mainCode,
    files: finalFiles,
  };
}
