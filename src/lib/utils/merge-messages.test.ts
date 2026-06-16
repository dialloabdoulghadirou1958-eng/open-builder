import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Message } from "../ai/generator-types";

function createStorageStub(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("mergeMessages", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", createStorageStub());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("groups user attachments and hides background memory tool calls", async () => {
    const { mergeMessages } = await import("./merge-messages");
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Build a dashboard" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          { type: "text", text: "[File: spec.txt | 12]\nHello world!" },
        ],
      },
      {
        role: "assistant",
        content: "I'll update the files.",
        tool_calls: [
          {
            id: "call-memory",
            type: "function",
            function: {
              name: "manage_memories",
              arguments: '{"operations":[]}',
            },
          },
          {
            id: "call-patch",
            type: "function",
            function: {
              name: "patch_file",
              arguments: '{"path":"src/App.tsx","patches":[]}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-memory",
        content: "OK",
      },
      {
        role: "tool",
        tool_call_id: "call-patch",
        content: "OK — modified: src/App.tsx",
      },
    ];

    const merged = mergeMessages(messages);

    expect(merged).toHaveLength(2);
    expect(merged[0].role).toBe("user");
    expect(merged[0].blocks.map((b) => b.type)).toEqual([
      "text",
      "image",
      "file",
    ]);
    expect(merged[1].role).toBe("assistant");
    expect(
      merged[1].blocks.some(
        (block) =>
          block.type === "tool" && block.toolName === "manage_memories",
      ),
    ).toBe(false);
    expect(
      merged[1].blocks.some(
        (block) => block.type === "tool" && block.toolName === "patch_file",
      ),
    ).toBe(true);
  });
});
