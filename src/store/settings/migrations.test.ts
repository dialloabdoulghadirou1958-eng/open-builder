import { describe, expect, it } from "vitest";
import { migrateSettings } from "./migrations";

describe("migrateSettings", () => {
  it("preserves plaintext API keys from older persisted settings", () => {
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

    expect(migrated.ai.apiKey).toBe("sk-test");
  });

  it("adds missing system defaults for older persisted settings", () => {
    const migrated = migrateSettings({ ai: {} }, 4) as {
      system: {
        reverseProxy: boolean;
        planModeEnabled: boolean;
        autoQaEnabled: boolean;
        developerSkillScriptsEnabled: boolean;
      };
    };

    expect(migrated.system.reverseProxy).toBe(false);
    expect(migrated.system.planModeEnabled).toBe(false);
    expect(migrated.system.autoQaEnabled).toBe(false);
    expect(migrated.system.developerSkillScriptsEnabled).toBe(false);
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

  it("removes custom search endpoints while preserving provider settings", () => {
    const migrated = migrateSettings(
      {
        webSearch: {
          engine: "tavily",
          tavilyApiKey: "local-search-key",
          tavilyApiUrl: "https://search.example.com",
          firecrawlApiKey: "local-reader-key",
          firecrawlApiUrl: "https://reader.example.com",
        },
        assetSearch: {
          engine: "pixabay",
          pixabayApiKey: "local-asset-key",
          pixabayApiUrl: "https://images.example.com",
          unsplashApiKey: "local-photo-key",
          unsplashApiUrl: "https://photos.example.com",
        },
      },
      13,
    ) as Record<string, any>;

    expect(migrated.webSearch).toMatchObject({
      engine: "tavily",
      tavilyApiKey: "local-search-key",
      firecrawlApiKey: "local-reader-key",
    });
    expect(migrated.assetSearch).toMatchObject({
      engine: "pixabay",
      pixabayApiKey: "local-asset-key",
      unsplashApiKey: "local-photo-key",
    });
    expect(migrated.webSearch).not.toHaveProperty("tavilyApiUrl");
    expect(migrated.webSearch).not.toHaveProperty("firecrawlApiUrl");
    expect(migrated.assetSearch).not.toHaveProperty("pixabayApiUrl");
    expect(migrated.assetSearch).not.toHaveProperty("unsplashApiUrl");
  });

  it("adds local CLI defaults without changing existing API configuration", () => {
    const migrated = migrateSettings(
      {
        ai: {
          apiType: "anthropic",
          apiKey: "existing-key",
          apiBaseUrl: "https://api.anthropic.com",
          model: "existing-model",
        },
      },
      15,
    ) as Record<string, any>;

    expect(migrated.ai).toMatchObject({
      runtime: "api",
      apiType: "anthropic",
      apiKey: "existing-key",
      apiBaseUrl: "https://api.anthropic.com",
      model: "existing-model",
      localAgent: {
        provider: "codex",
        codex: { model: "", effort: "" },
        claude: { model: "", effort: "" },
      },
    });
  });

  it("preserves valid provider-specific local CLI preferences", () => {
    const migrated = migrateSettings(
      {
        ai: {
          runtime: "localCli",
          localAgent: {
            provider: "claude",
            codex: { model: "codex-model", effort: "high" },
            claude: { model: "claude-model", effort: "medium" },
          },
        },
      },
      15,
    ) as Record<string, any>;

    expect(migrated.ai).toMatchObject({
      runtime: "localCli",
      localAgent: {
        provider: "claude",
        codex: { model: "codex-model", effort: "high" },
        claude: { model: "claude-model", effort: "medium" },
      },
    });
  });
});
