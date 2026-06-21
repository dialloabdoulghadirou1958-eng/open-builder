import { describe, expect, it } from "vitest";
import type { Conversation, ProjectSnapshot } from "../../types";
import {
  buildConversationGenerationLog,
  cloneImportedConversation,
  cloneImportedSnapshots,
  createConversationExport,
  exportFileName,
  MAX_IMPORT_FILE_BYTES,
  parseConversationExport,
} from "./conversation-export";
import { COMPRESSED_CONTEXT_LIMITS } from "./compress-context";

const conversation: Conversation = {
  id: "original-conv",
  title: "Demo App",
  messages: [{ role: "user", content: "Build a demo" }],
  files: { "src/App.tsx": "export function App() { return null; }" },
  template: "vite-react-ts",
  isProjectInitialized: true,
  createdAt: 1,
  updatedAt: 2,
};

const snapshots: ProjectSnapshot[] = [
  {
    id: "snap-1",
    conversationId: "original-conv",
    messageId: "assistant-0",
    patches: {},
    addedFiles: { "src/App.tsx": "export function App() { return null; }" },
    deletedFiles: [],
    createdAt: 3,
    kind: "checkpoint",
    fullFiles: { "src/App.tsx": "export function App() { return null; }" },
  },
];

describe("conversation export utilities", () => {
  it("round-trips a versioned conversation export payload", () => {
    const payload = createConversationExport(conversation, snapshots, 10);
    const parsed = parseConversationExport(JSON.stringify(payload));

    expect(parsed).toEqual(payload);
    expect(parsed.generationLog?.project.snapshotCount).toBe(1);
  });

  it("parses legacy exports without generation logs", () => {
    const payload = {
      schema: "open-builder.conversation",
      version: 1,
      exportedAt: 10,
      conversation,
      snapshots,
    };

    const parsed = parseConversationExport(JSON.stringify(payload));

    expect(parsed.generationLog).toBeUndefined();
  });

  it("rejects unsupported import payloads", () => {
    expect(() => parseConversationExport('{"version":999}')).toThrow(
      "Unsupported Open Builder conversation export format.",
    );
    expect(() => parseConversationExport("not json")).toThrow(
      "Import file is not valid JSON.",
    );
  });

  it("rejects malformed messages and cross-conversation snapshots", () => {
    expect(() =>
      parseConversationExport(
        JSON.stringify({
          schema: "open-builder.conversation",
          version: 1,
          exportedAt: 10,
          conversation: {
            ...conversation,
            messages: [{ role: "assistant", content: [{ type: "unknown" }] }],
          },
          snapshots,
        }),
      ),
    ).toThrow("Import file contains an invalid conversation.");

    expect(() =>
      parseConversationExport(
        JSON.stringify({
          schema: "open-builder.conversation",
          version: 1,
          exportedAt: 10,
          conversation,
          snapshots: [{ ...snapshots[0], conversationId: "other-conv" }],
        }),
      ),
    ).toThrow("Import file contains snapshots for another conversation.");
  });

  it("rejects unknown structured error metadata", () => {
    expect(() =>
      parseConversationExport(
        JSON.stringify({
          schema: "open-builder.conversation",
          version: 1,
          exportedAt: 10,
          conversation: {
            ...conversation,
            messages: [
              {
                role: "assistant",
                content: "bad",
                isError: true,
                errorKind: "mystery",
              },
            ],
          },
          snapshots: [],
        }),
      ),
    ).toThrow("Import file contains an invalid conversation.");
  });

  it("rejects malformed compressed context metadata", () => {
    expect(() =>
      parseConversationExport(
        JSON.stringify({
          schema: "open-builder.conversation",
          version: 1,
          exportedAt: 10,
          conversation: {
            ...conversation,
            compressedContext: { summary: 123, fromIndex: "bad" },
          },
          snapshots: [],
        }),
      ),
    ).toThrow("Import file contains an invalid conversation.");
  });

  it("rejects imported project files that exceed the per-file budget", () => {
    expect(() =>
      parseConversationExport(
        JSON.stringify({
          schema: "open-builder.conversation",
          version: 1,
          exportedAt: 10,
          conversation: {
            ...conversation,
            files: {
              "src/large.txt": "x".repeat(MAX_IMPORT_FILE_BYTES + 1),
            },
          },
          snapshots: [],
        }),
      ),
    ).toThrow("Import file contains a file over");
  });

  it("clones imported conversations and snapshots onto new ids", () => {
    const imported = cloneImportedConversation(
      {
        ...conversation,
        archived: true,
        pinned: true,
        compressedContext: {
          summary: "x".repeat(COMPRESSED_CONTEXT_LIMITS.maxSummaryChars + 5),
          fromIndex: 1.8,
        },
      },
      "new-conv",
      20,
    );
    const importedSnapshots = cloneImportedSnapshots(
      snapshots,
      imported.id,
      20,
    );

    expect(imported).toMatchObject({
      id: "new-conv",
      title: "Demo App",
      archived: false,
      pinned: false,
      createdAt: 20,
      updatedAt: 20,
    });
    expect(imported.files).toEqual(conversation.files);
    expect(imported.files).not.toBe(conversation.files);
    expect(imported.compressedContext?.fromIndex).toBe(1);
    expect(imported.compressedContext?.summary).toContain(
      "[compressed context truncated after",
    );
    expect(importedSnapshots[0].conversationId).toBe("new-conv");
    expect(importedSnapshots[0].id).not.toBe("snap-1");
    expect(importedSnapshots[0].createdAt).toBe(20);
  });

  it("creates filesystem-friendly export names", () => {
    expect(exportFileName("Demo App!")).toBe("demo-app.open-builder.json");
    expect(exportFileName("")).toBe("open-builder-session.open-builder.json");
  });

  it("builds generation log summaries from messages and snapshots", () => {
    const log = buildConversationGenerationLog(
      {
        ...conversation,
        messages: [
          { role: "user", content: "Build a demo" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "src/App.tsx",
                    content: "x".repeat(400),
                  }),
                },
              },
              {
                id: "call-2",
                type: "function",
                function: {
                  name: "project_health_check",
                  arguments: "{}",
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call-1",
            content: "OK",
          },
          {
            role: "tool",
            tool_call_id: "call-2",
            content: JSON.stringify({ ok: false, error: "bad" }),
          },
          {
            role: "assistant",
            content: "Done",
          },
        ],
      },
      snapshots,
      30,
    );

    expect(log.generatedAt).toBe(30);
    expect(log.messages).toMatchObject({
      total: 5,
      user: 1,
      assistant: 2,
      tool: 2,
    });
    expect(log.tools.byName).toEqual({
      write_file: 1,
      project_health_check: 1,
    });
    expect(log.tools.failedResultCount).toBe(1);
    expect(log.tools.timeline[0].argsPreview.length).toBeLessThanOrEqual(303);
    expect(log.project).toMatchObject({
      fileCount: 1,
      snapshotCount: 1,
      checkpointCount: 1,
    });
  });
});
