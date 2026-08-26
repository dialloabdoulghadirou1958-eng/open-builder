import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationStore } from "./conversation";
import { useSnapshotStore } from "./snapshot";
import { PROJECT_FILE_LIMITS } from "../lib/utils/project-files";

const localforageMock = vi.hoisted(() => {
  const store = new Map<string, string>();
  const removeItem = vi.fn(async (key: string) => {
    store.delete(key);
  });
  const adapter = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem,
  };
  return {
    ...adapter,
    createInstance: () => adapter,
  };
});

vi.mock("localforage", () => ({
  default: localforageMock,
}));

describe("conversation store", () => {
  beforeEach(() => {
    localforageMock.removeItem.mockClear();
    useConversationStore.setState({
      conversations: {},
      activeId: null,
      _hasHydrated: true,
    });
    useSnapshotStore.setState({ snapshots: {}, _hasHydrated: true });
  });

  it("rejects oversized project trees from setFiles", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = useConversationStore.getState().createConversation();

    useConversationStore.getState().setFiles({
      "src/large.ts": "x".repeat(PROJECT_FILE_LIMITS.maxFileBytes + 1),
    });

    expect(useConversationStore.getState().conversations[id].files).toEqual({});
    warn.mockRestore();
  });

  it("rejects oversized project trees when adding a conversation", () => {
    expect(() =>
      useConversationStore.getState().addConversation({
        id: "imported",
        title: "Imported",
        messages: [],
        files: {
          "src/large.ts": "x".repeat(PROJECT_FILE_LIMITS.maxFileBytes + 1),
        },
        template: "vite-react-ts",
        isProjectInitialized: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ).toThrow(/too large/i);
  });

  it("writes compressed context to the requested conversation, not the active one", () => {
    const first = useConversationStore.getState().createConversation();
    const second = useConversationStore.getState().createConversation();

    useConversationStore.getState().setCompressedContextForConversation(first, {
      fromIndex: 1.8,
      summary: "summary",
    });

    const state = useConversationStore.getState();

    expect(state.activeId).toBe(second);
    expect(state.conversations[first].compressedContext).toMatchObject({
      fromIndex: 1,
      summary: "summary",
    });
    expect(state.conversations[second].compressedContext).toBeUndefined();
  });

  it("redacts credentials before persisting compressed context", () => {
    const sentinel = "persisted-summary-secret-sentinel";
    const id = useConversationStore.getState().createConversation();

    useConversationStore.getState().setCompressedContextForConversation(id, {
      fromIndex: 1,
      summary: `{"api_key":"${sentinel}"}`,
    });

    const summary =
      useConversationStore.getState().conversations[id].compressedContext
        ?.summary;
    expect(summary).not.toContain(sentinel);
    expect(summary).toContain("[REDACTED]");
  });

  it("clears conversation context without deleting project files or snapshots", () => {
    const id = useConversationStore.getState().createConversation();
    useConversationStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [id]: {
          ...state.conversations[id],
          messages: [{ role: "user", content: "Build it" }],
          files: { "src/App.tsx": "export default function App() {}" },
          activeFile: "src/App.tsx",
          template: "react-ts",
          isProjectInitialized: true,
          compressedContext: { summary: "Earlier work", fromIndex: 1 },
        },
      },
    }));
    useSnapshotStore.setState({
      snapshots: {
        [id]: [
          {
            id: "snapshot-1",
            conversationId: id,
            messageId: "assistant-1",
            patches: {},
            addedFiles: { "src/App.tsx": "export default function App() {}" },
            deletedFiles: [],
            createdAt: 1,
          },
        ],
      },
    });

    useConversationStore.getState().clearContext();

    const conversation = useConversationStore.getState().conversations[id];
    expect(conversation.messages).toEqual([]);
    expect(conversation.compressedContext).toBeUndefined();
    expect(conversation.files).toEqual({
      "src/App.tsx": "export default function App() {}",
    });
    expect(conversation.activeFile).toBe("src/App.tsx");
    expect(conversation.template).toBe("react-ts");
    expect(conversation.isProjectInitialized).toBe(true);
    expect(useSnapshotStore.getState().snapshots[id]).toHaveLength(1);
  });

  it("resets project state and deletes only the active conversation snapshots", () => {
    const first = useConversationStore.getState().createConversation();
    const second = useConversationStore.getState().createConversation();
    useConversationStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [second]: {
          ...state.conversations[second],
          messages: [{ role: "user", content: "Build it" }],
          files: { "src/App.tsx": "old code" },
          activeFile: "src/App.tsx",
          template: "nextjs",
          isProjectInitialized: true,
          compressedContext: { summary: "Old context", fromIndex: 1 },
        },
      },
    }));
    useSnapshotStore.setState({
      snapshots: {
        [first]: [],
        [second]: [
          {
            id: "snapshot-2",
            conversationId: second,
            messageId: "assistant-2",
            patches: {},
            addedFiles: { "src/App.tsx": "old code" },
            deletedFiles: [],
            createdAt: 2,
          },
        ],
      },
    });

    useConversationStore.getState().resetProject();

    const conversation = useConversationStore.getState().conversations[second];
    expect(conversation).toMatchObject({
      messages: [],
      files: {},
      template: "vite-react-ts",
      isProjectInitialized: false,
    });
    expect(conversation.compressedContext).toBeUndefined();
    expect(conversation.activeFile).toBeUndefined();
    expect(useSnapshotStore.getState().snapshots[second]).toBeUndefined();
    expect(useSnapshotStore.getState().snapshots[first]).toEqual([]);
  });

  it("can persist a delayed edit to a conversation that is no longer active", () => {
    const first = useConversationStore.getState().createConversation();
    const second = useConversationStore.getState().createConversation();

    useConversationStore
      .getState()
      .setFilesForConversation(first, { "src/App.tsx": "saved edit" });

    const state = useConversationStore.getState();
    expect(state.activeId).toBe(second);
    expect(state.conversations[first].files).toEqual({
      "src/App.tsx": "saved edit",
    });
    expect(state.conversations[second].files).toEqual({});
  });

  it("persists an active file and falls back when that file is removed", () => {
    const id = useConversationStore.getState().createConversation();
    useConversationStore.getState().setFiles({
      "src/App.tsx": "app",
      "src/main.tsx": "main",
    });
    useConversationStore.getState().setActiveFile("src/main.tsx");
    expect(useConversationStore.getState().conversations[id].activeFile).toBe(
      "src/main.tsx",
    );

    useConversationStore.getState().setFiles({ "src/App.tsx": "app" });
    expect(useConversationStore.getState().conversations[id].activeFile).toBe(
      "src/App.tsx",
    );
  });

  it("preserves shared attachment blobs until the final fork is deleted", async () => {
    const original = useConversationStore.getState().createConversation();
    useConversationStore.getState().setFiles({ "src/App.tsx": "app" });
    useConversationStore.getState().setActiveFile("src/App.tsx");
    useConversationStore.getState().setMessages([
      {
        role: "user",
        content: "Review",
        metadata: {
          attachments: [
            {
              id: "shared-pdf",
              type: "file",
              name: "spec.pdf",
              mimeType: "application/pdf",
              size: 10,
            },
          ],
        },
      },
    ]);
    const fork = useConversationStore.getState().forkConversation();

    expect(useConversationStore.getState().conversations[fork].activeFile).toBe(
      "src/App.tsx",
    );
    useConversationStore.getState().deleteConversation(fork);
    await Promise.resolve();
    expect(localforageMock.removeItem).not.toHaveBeenCalledWith("shared-pdf");

    useConversationStore.getState().deleteConversation(original);
    await Promise.resolve();
    expect(localforageMock.removeItem).toHaveBeenCalledWith("shared-pdf");
  });
});
