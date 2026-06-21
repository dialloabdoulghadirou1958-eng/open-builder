import { describe, expect, it } from "vitest";
import { mergePendingSecretMigration } from "./vault";

describe("vault pending secret migration", () => {
  it("merges staged secret writes without dropping existing fields", () => {
    expect(
      mergePendingSecretMigration(
        { apiKey: "old-key", refreshToken: "refresh" },
        { accessToken: "access", tokenExpiresAt: 123 },
      ),
    ).toEqual({
      apiKey: "old-key",
      refreshToken: "refresh",
      accessToken: "access",
      tokenExpiresAt: 123,
    });
  });

  it("preserves explicit null deletes as pending operations", () => {
    expect(
      mergePendingSecretMigration(
        { apiKey: "old-key", accessToken: "access" },
        { apiKey: null, accessToken: null },
      ),
    ).toEqual({
      apiKey: null,
      accessToken: null,
    });
  });
});
