import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchSearchProviders,
  fetchServerModels,
  MOHUA_API_LIMITS,
  setMohuaAuthProvider,
} from "./mohua-api";

describe("Mohua API catalog guards", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_MOHUA_API_URL", "https://mohua.example");
    setMohuaAuthProvider({
      getToken: async () => "token",
      refreshToken: async () => null,
      clearAuth: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("bounds and cleans server model catalogs", async () => {
    const data: Array<Record<string, unknown>> = Array.from(
      { length: MOHUA_API_LIMITS.maxCatalogItems + 10 },
      (_, i) => ({
        id: `model-${i}`,
        name: `Model ${i}`,
        context_length: i === 0 ? 99_000_000 : 128000,
      }),
    );
    data.push({ id: "", name: "bad" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data })),
    );

    const models = await fetchServerModels();

    expect(models).toHaveLength(MOHUA_API_LIMITS.maxCatalogItems);
    expect(models[0]).toEqual({
      id: "model-0",
      displayName: "Model 0",
      maxContextTokens: 10_000_000,
    });
  });

  it("drops malformed provider entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { id: "tavily", name: "Tavily", slug: "tavily" },
            { id: "bad", name: "", slug: "bad" },
            { id: "bad\u0000", name: "Bad", slug: "bad" },
          ],
        }),
      ),
    );

    await expect(fetchSearchProviders()).resolves.toEqual([
      { id: "tavily", name: "Tavily", slug: "tavily" },
    ]);
  });

  it("rejects oversized API responses by content length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: {
              "content-length": String(MOHUA_API_LIMITS.maxJsonBytes + 1),
            },
          }),
      ),
    );

    await expect(fetchServerModels()).rejects.toThrow(/too large/i);
  });
});
