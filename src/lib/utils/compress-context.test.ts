import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../ai/generator";
import { compressContext } from "./compress-context";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getProviderModel: vi.fn(() => ({ provider: "mock-model" })),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

vi.mock("../ai/provider", () => ({
  getProviderModel: mocks.getProviderModel,
}));

const cfg = {
  apiType: "openai-compatible" as const,
  apiBaseUrl: "https://api.example.com",
  apiKey: "test-key",
  model: "test-model",
};

describe("compressContext", () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.getProviderModel.mockClear();
    mocks.getProviderModel.mockReturnValue({ provider: "mock-model" });
  });

  it("returns null when there are fewer than two user messages", async () => {
    await expect(
      compressContext([{ role: "user", content: "Only one turn" }], cfg),
    ).resolves.toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("summarizes older messages and appends the current file inventory", async () => {
    mocks.generateText.mockResolvedValue({ text: "Short summary." });
    const messages: Message[] = [
      { role: "user", content: "Build a timer" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "write_file",
              arguments: '{"path":"src/App.tsx","content":"..."}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        content: "OK — created: src/App.tsx",
      },
      { role: "user", content: "Make it prettier" },
    ];

    const result = await compressContext(messages, cfg, undefined, {
      "src/App.tsx": "export function App() { return null; }",
      "package.json": "{}",
    });

    expect(result).toEqual({
      summary:
        "Short summary.\n\n[Current project files (2)]\n- package.json\n- src/App.tsx",
      fromIndex: 3,
    });
    expect(mocks.getProviderModel).toHaveBeenCalledWith(cfg);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const request = mocks.generateText.mock.calls[0][0];
    const summaryInput = request.messages[1].content[0].text as string;
    expect(summaryInput).toContain("user: Build a timer");
    expect(summaryInput).toContain(
      'assistant_tool_calls: write_file({"path":"src/App.tsx","content":"..."})',
    );
    expect(summaryInput).toContain("tool_result: OK — created: src/App.tsx");
    expect(summaryInput).not.toContain("Make it prettier");
  });
});
