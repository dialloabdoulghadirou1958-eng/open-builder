import { describe, expect, it } from "vitest";
import {
  messagesToModelMessages,
  MODEL_MESSAGE_LIMITS,
} from "./messages";
import { TOOL_RESULT_LIMITS } from "../utils/tool-result";
import type { Message } from "./generator-types";

describe("messagesToModelMessages", () => {
  it("truncates oversized text and tool result content before model requests", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "u".repeat(MODEL_MESSAGE_LIMITS.maxTextChars + 5),
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_files",
              arguments: JSON.stringify({
                paths: ["src/App.tsx"],
                padding: "x".repeat(
                  MODEL_MESSAGE_LIMITS.maxToolArgumentsChars + 1,
                ),
              }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        content: "r".repeat(TOOL_RESULT_LIMITS.maxModelResultChars + 5),
      },
    ];

    const out = messagesToModelMessages(messages);

    expect(out[0].role).toBe("user");
    expect(out[0].content as string).toContain("user message truncated");
    const assistant = out[1];
    expect(assistant.role).toBe("assistant");
    expect((assistant.content as any[])[0].input).toEqual(
      expect.objectContaining({ omitted: true }),
    );
    const tool = out[2];
    expect(tool.role).toBe("tool");
    expect((tool.content as any[])[0].output.value).toContain(
      "[tool result truncated after",
    );
  });

  it("omits unsupported or oversized images", () => {
    const out = messagesToModelMessages([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/svg+xml;base64,PHN2Zz4=" },
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${"a".repeat(
                MODEL_MESSAGE_LIMITS.maxImageUrlChars + 1,
              )}`,
            },
          },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGVsbG8=" },
          },
        ],
      },
    ]);

    const parts = out[0].content as any[];
    expect(parts[0]).toEqual({
      type: "text",
      text: "[Image omitted: unsupported or too large]",
    });
    expect(parts[1]).toEqual({
      type: "text",
      text: "[Image omitted: unsupported or too large]",
    });
    expect(parts[2]).toEqual({
      type: "image",
      image: "data:image/png;base64,aGVsbG8=",
    });
  });
});
