// ============================================================================
//  ai-messages.ts
//  消息格式转换 —— 内部 Message 格式 ↔ AI SDK ModelMessage 格式
// ============================================================================

import type {
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
  AssistantContent,
  UserContent,
} from "ai";
import type { Message, ContentPart } from "./generator-types";
import type { ApiType } from "./provider";
import { normalizeToolResultForModel } from "../utils/tool-result";

export const MODEL_MESSAGE_LIMITS = {
  maxTextChars: 160_000,
  maxToolArgumentsChars: 80_000,
  maxImageUrlChars: 2_000_000,
} as const;

function truncateModelText(text: string, label = "message"): string {
  if (text.length <= MODEL_MESSAGE_LIMITS.maxTextChars) return text;
  return (
    text.slice(0, MODEL_MESSAGE_LIMITS.maxTextChars) +
    `\n\n[${label} truncated after ${MODEL_MESSAGE_LIMITS.maxTextChars} chars]`
  );
}

function normalizeImageUrlForModel(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MODEL_MESSAGE_LIMITS.maxImageUrlChars) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function parseToolInputForModel(rawArguments: string): unknown {
  if (rawArguments.length > MODEL_MESSAGE_LIMITS.maxToolArgumentsChars) {
    return {
      omitted: true,
      reason: `tool arguments exceeded ${MODEL_MESSAGE_LIMITS.maxToolArgumentsChars} chars`,
    };
  }
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

/**
 * 将内部 Message[] 转换为 AI SDK ModelMessage[]
 * 在调用 streamText / generateText 前使用
 */
export function messagesToModelMessages(
  messages: Message[],
  apiType?: ApiType,
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    switch (msg.role) {
      case "system":
        result.push({
          role: "system",
          content:
            typeof msg.content === "string"
              ? truncateModelText(msg.content, "system message")
              : "",
        });
        break;

      case "user": {
        if (typeof msg.content === "string") {
          result.push({
            role: "user",
            content: truncateModelText(msg.content, "user message"),
          });
        } else if (Array.isArray(msg.content)) {
          const parts: UserContent = msg.content.map((part: ContentPart) => {
            if (part.type === "text") {
              return {
                type: "text" as const,
                text: truncateModelText(part.text, "user text part"),
              };
            }
            // image_url → AI SDK image part
            const imageUrl = normalizeImageUrlForModel(part.image_url.url);
            if (!imageUrl) {
              return {
                type: "text" as const,
                text: "[Image omitted: unsupported or too large]",
              };
            }
            return {
              type: "image" as const,
              image: imageUrl,
            };
          });
          result.push({ role: "user", content: parts });
        }
        break;
      }

      case "assistant": {
        const content: AssistantContent = [];

        // 文本内容
        if (msg.content && typeof msg.content === "string") {
          content.push({
            type: "text",
            text: truncateModelText(msg.content, "assistant message"),
          });
        }

        // tool_calls → AI SDK tool-call parts
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            const args = parseToolInputForModel(tc.function.arguments);
            const toolCallPart: ToolCallPart = {
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.function.name,
              input: args,
            };
            // Google Gemini with thinking enabled requires thought_signature
            // on functionCall parts; skip the validator to avoid the warning.
            if (apiType === "google") {
              toolCallPart.providerOptions = {
                google: {
                  thoughtSignature: "skip_thought_signature_validator",
                },
              };
            }
            content.push(toolCallPart);
          }
        }

        // 如果没有任何内容（不应该发生但做防御）
        if (content.length === 0) {
          content.push({ type: "text", text: "" });
        }

        result.push({ role: "assistant", content });
        break;
      }

      case "tool": {
        // 查找对应的 toolName（从前一个 assistant 消息的 tool_calls 中）
        const toolName = findToolName(messages, i, msg.tool_call_id);

        const text =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        const normalizedText = normalizeToolResultForModel(text).result;
        const toolResult: ToolResultPart = {
          type: "tool-result",
          toolCallId: msg.tool_call_id || "",
          toolName,
          output: { type: "text", value: normalizedText },
        };

        // 检查前一条是否已经是 tool role 的 ModelMessage，如果是则合并
        const prev = result[result.length - 1];
        if (prev && prev.role === "tool" && Array.isArray(prev.content)) {
          (prev.content as ToolResultPart[]).push(toolResult);
        } else {
          result.push({
            role: "tool",
            content: [toolResult],
          });
        }
        break;
      }
    }
  }

  return result;
}

/**
 * 在消息列表中查找某个 tool_call_id 对应的 toolName
 * 从当前位置向前搜索最近的 assistant 消息
 */
function findToolName(
  messages: Message[],
  currentIndex: number,
  toolCallId?: string,
): string {
  if (!toolCallId) return "unknown";

  for (let j = currentIndex - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role === "assistant" && m.tool_calls) {
      const tc = m.tool_calls.find((t) => t.id === toolCallId);
      if (tc) return tc.function.name;
    }
  }
  return "unknown";
}
