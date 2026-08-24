import { afterEach, describe, expect, it, vi } from "vitest";

function createMemoryStorage() {
  const records = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return records.size;
    },
    clear: vi.fn(() => records.clear()),
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    key: vi.fn((index: number) => [...records.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => records.delete(key)),
    setItem: vi.fn((key: string, value: string) => records.set(key, value)),
  };

  return { records, storage };
}

describe("settings persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists the AI API key across reload and clears the test value", async () => {
    const { records, storage } = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);

    const firstLoad = await import("./index");
    firstLoad.useSettingsStore.getState().setAI({
      apiType: "openai-compatible",
      apiKey: "sk-local-persistence-test",
      apiBaseUrl: "https://api.example.com/v1",
      model: "test-model",
    });

    await vi.waitFor(() => {
      expect(records.get("open-builder-settings")).toContain(
        "sk-local-persistence-test",
      );
    });

    vi.resetModules();
    const secondLoad = await import("./index");
    await secondLoad.useSettingsStore.persist.rehydrate();

    expect(secondLoad.useSettingsStore.getState().ai.apiKey).toBe(
      "sk-local-persistence-test",
    );

    secondLoad.useSettingsStore.getState().resetAll();
    await vi.waitFor(() => {
      expect(records.get("open-builder-settings")).not.toContain(
        "sk-local-persistence-test",
      );
    });
  });
});
