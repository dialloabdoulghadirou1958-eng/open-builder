import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationStore } from "./conversation";
import { PROJECT_FILE_LIMITS } from "../lib/utils/project-files";

const localforageMock = vi.hoisted(() => {
  const store = new Map<string, string>();
  const adapter = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  };
  return {
    ...adapter,
    createInstance: () => adapter,
  };
});

vi.mock("localforage", () => ({
  default: localforageMock,
}));

describe("conversation store project file guard", () => {
  beforeEach(() => {
    useConversationStore.setState({
      conversations: {},
      activeId: null,
      _hasHydrated: true,
    });
  });

  it("rejects oversized project trees from setFiles", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = useConversationStore.getState().createConversation();

    useConversationStore
      .getState()
      .setFiles({ "src/large.ts": "x".repeat(PROJECT_FILE_LIMITS.maxFileBytes + 1) });

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

    useConversationStore
      .getState()
      .setCompressedContextForConversation(first, {
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
});
