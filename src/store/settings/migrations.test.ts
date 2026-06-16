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
      serverService: { webSearchEnabled: boolean; assetSearchEnabled: boolean };
    };

    expect(migrated.system.reverseProxy).toBe(false);
    expect(migrated.system.planModeEnabled).toBe(false);
    expect(migrated.system.autoQaEnabled).toBe(false);
    expect(migrated.serverService.webSearchEnabled).toBe(true);
    expect(migrated.serverService.assetSearchEnabled).toBe(true);
  });
});
