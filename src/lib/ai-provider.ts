// ============================================================================
//  ai-provider.ts
//  AI SDK Provider 工厂 —— 根据 apiType 创建对应的 AI SDK Provider 实例
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, wrapLanguageModel, extractReasoningMiddleware } from "ai";
import type { ToolSet } from "ai";
import type {
  OpenAILanguageModelChatOptions,
  OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApiType = "openai-compatible" | "openai" | "anthropic" | "google";

/** 各类型的默认 API Base URL（不含版本路径，用户可自行附加 /v1、/v1beta、/v2 等） */
export const DEFAULT_BASE_URLS: Record<ApiType, string> = {
  "openai-compatible": "http://localhost:11434",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
};

/** 各类型的默认版本路径（当用户 URL 没有版本后缀时自动追加） */
const DEFAULT_VERSION_PATHS: Record<ApiType, string> = {
  "openai-compatible": "/v1",
  openai: "/v1",
  anthropic: "/v1",
  google: "/v1beta",
};

export interface ProviderConfig {
  apiType: ApiType;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

// ─── URL Helpers ─────────────────────────────────────────────────────────────

/**
 * 从 baseURL 中提取 hostname 作为 provider name
 */
function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "custom";
  }
}

/**
 * 检测 URL 是否已包含版本路径（如 /v1、/v1beta、/v2 等）
 */
function hasVersionPath(url: string): boolean {
  return /\/v\d+(\w*)$/.test(url);
}

/**
 * 解析最终的 baseURL：如果用户 URL 已包含版本路径则原样使用，
 * 否则自动追加对应 apiType 的默认版本路径
 */
export function resolveBaseURL(url: string, apiType: ApiType): string {
  const cleaned = url.replace(/\/+$/, "");
  if (hasVersionPath(cleaned)) return cleaned;
  return cleaned + DEFAULT_VERSION_PATHS[apiType];
}

// ─── Provider Factory ────────────────────────────────────────────────────────

/**
 * 根据 apiType 创建对应的 AI SDK provider 实例并返回 LanguageModel
 */
export function getProviderModel(config: ProviderConfig): LanguageModel {
  const { apiType, apiBaseUrl, apiKey, model, headers } = config;
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  let lm: LanguageModel;

  switch (apiType) {
    case "openai": {
      const provider = createOpenAI({
        apiKey,
        baseURL,
        headers,
      });
      lm = provider.responses(model);
      break;
    }

    case "anthropic": {
      const provider = createAnthropic({
        apiKey,
        baseURL,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
          ...headers,
        },
      });
      lm = provider(model);
      break;
    }

    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL,
        headers,
      });
      lm = provider(model);
      break;
    }

    case "openai-compatible":
    default: {
      const provider = createOpenAICompatible({
        name: getHostname(baseURL),
        baseURL,
        apiKey,
        headers,
      });
      lm = provider(model);
      break;
    }
  }

  // 兼容类似 DeepSeek 会使用 <think> 标签的情况
  return wrapLanguageModel({
    model: lm,
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}

// ─── Provider Options ────────────────────────────────────────────────────────

/**
 * 根据 apiType 构建 provider 专属的 reasoning/thinking 选项
 */
export function buildProviderOptions(
  apiType: ApiType,
  thinkingBudget: number,
): Record<string, Record<string, unknown>> {
  switch (apiType) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: thinkingBudget },
        } satisfies AnthropicLanguageModelOptions,
      };

    case "openai":
      return {
        openai: {
          reasoningSummary: "detailed",
        } satisfies OpenAILanguageModelResponsesOptions,
      };

    case "google":
      return {
        google: {
          thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
        } satisfies GoogleLanguageModelOptions,
      };

    case "openai-compatible":
    default:
      return {
        openai: {
          reasoningEffort: "high",
        } satisfies OpenAILanguageModelChatOptions,
      };
  }
}

// ─── Model List Fetching ─────────────────────────────────────────────────────

/**
 * 根据 apiType 获取可用模型列表，返回统一格式的模型 ID 数组
 */
export async function fetchModelList(
  apiType: ApiType,
  apiBaseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  switch (apiType) {
    case "openai-compatible":
    case "openai": {
      // GET {baseURL}/models
      const url = `${baseURL}/models`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.data || [])
        .map((m: { id?: string }) => m.id)
        .filter(Boolean)
        .sort() as string[];
    }

    case "anthropic": {
      // GET {baseURL}/models
      const url = `${baseURL}/models`;
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.data || [])
        .map((m: { id?: string }) => m.id)
        .filter(Boolean)
        .sort() as string[];
    }

    case "google": {
      // GET {baseURL}/models?key={apiKey}
      const url = `${baseURL}/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.models || [])
        .map((m: { name?: string }) => m.name?.replace(/^models\//, ""))
        .filter(Boolean)
        .sort() as string[];
    }

    default:
      return [];
  }
}

// ─── Built-in Search Tools ──────────────────────────────────────────────────

export interface BuiltinSearchConfig {
  /** Provider-managed tools to merge into the ToolSet */
  tools?: ToolSet;
  /** Names of tools executed server-side — used to filter stream events */
  providerToolNames: string[];
}

/**
 * 根据 apiType 创建对应 provider 的内置搜索配置
 * 返回 null 表示该 provider 不支持内置搜索
 */
export function getBuiltinSearchConfig(
  config: ProviderConfig,
): BuiltinSearchConfig | null {
  const { apiType, apiBaseUrl, apiKey, headers } = config;
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  switch (apiType) {
    case "openai": {
      const provider = createOpenAI({ apiKey, baseURL, headers });
      const tools: ToolSet = {
        web_search_preview: provider.tools.webSearch({
          searchContextSize: "high",
        }),
      };
      return { tools, providerToolNames: Object.keys(tools) };
    }

    case "anthropic": {
      const provider = createAnthropic({
        apiKey,
        baseURL,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
          ...headers,
        },
      });
      const tools: ToolSet = {
        web_search: provider.tools.webSearch_20250305({
          maxUses: 10,
        }),
      };
      return { tools, providerToolNames: Object.keys(tools) };
    }

    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL,
        headers,
      });
      const tools: ToolSet = {
        google_search: provider.tools.googleSearch({}),
      };
      return { tools, providerToolNames: Object.keys(tools) };
    }

    case "openai-compatible":
    default:
      return null;
  }
}
