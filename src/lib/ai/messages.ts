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
          content: typeof msg.content === "string" ? msg.content : "",
        });
        break;

      case "user": {
        if (typeof msg.content === "string") {
          result.push({ role: "user", content: msg.content });
        } else if (Array.isArray(msg.content)) {
          const parts: UserContent = msg.content.map((part: ContentPart) => {
            if (part.type === "text") {
              return { type: "text" as const, text: part.text };
            }
            // image_url → AI SDK image part
            return {
              type: "image" as const,
              image: part.image_url.url,
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
          content.push({ type: "text", text: msg.content });
        }

        // tool_calls → AI SDK tool-call parts
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let args: unknown;
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }
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
        const toolResult: ToolResultPart = {
          type: "tool-result",
          toolCallId: msg.tool_call_id || "",
          toolName,
          output: { type: "text", value: text },
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
