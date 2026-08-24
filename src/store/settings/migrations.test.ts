import { describe, expect, it } from "vitest";
import { migrateSettings, takeStashedApiKey } from "./migrations";

describe("migrateSettings", () => {
  it("moves plaintext API keys out of persisted settings in v9 migration", () => {
    const migrated = migrateSettings(
      {
        ai: {
          apiType: "openai-compatible",
          apiKey: "sk-test",
          apiBaseUrl: "https://api.example.com",
          model: "test-model",
        },
        system: {},
      },
      8,
    ) as { ai: { apiKey: string } };

    expect(migrated.ai.apiKey).toBe("");
    expect(takeStashedApiKey()).toBe("sk-test");
    expect(takeStashedApiKey()).toBeNull();
  });

  it("adds missing system defaults for older persisted settings", () => {
    const migrated = migrateSettings({ ai: {} }, 4) as {
      system: {
        reverseProxy: boolean;
        planModeEnabled: boolean;
        autoQaEnabled: boolean;
      };
    };

    expect(migrated.system.reverseProxy).toBe(false);
    expect(migrated.system.planModeEnabled).toBe(false);
    expect(migrated.system.autoQaEnabled).toBe(false);
  });

  it("removes legacy server settings without changing local providers", () => {
    const migrated = migrateSettings(
      {
        ai: { model: "local-model" },
        webSearch: {
          engine: "server",
          backendProvider: "remote-search",
          tavilyApiKey: "local-search-key",
        },
        assetSearch: {
          engine: "server",
          backendProvider: "remote-assets",
          pixabayApiKey: "local-asset-key",
        },
        serverService: { selectedModel: "remote-model" },
        serverServiceCache: { models: ["remote-model"] },
        modelCache: { apiKey: "legacy-cache-key" },
      },
      11,
    ) as Record<string, any>;

    expect(migrated.ai.model).toBe("local-model");
    expect(migrated.webSearch).toMatchObject({
      engine: "disabled",
      tavilyApiKey: "local-search-key",
    });
    expect(migrated.assetSearch).toMatchObject({
      engine: "disabled",
      pixabayApiKey: "local-asset-key",
    });
    expect(migrated.webSearch).not.toHaveProperty("backendProvider");
    expect(migrated.assetSearch).not.toHaveProperty("backendProvider");
    expect(migrated).not.toHaveProperty("serverService");
    expect(migrated).not.toHaveProperty("serverServiceCache");
    expect(migrated).not.toHaveProperty("modelCache");
  });
});
