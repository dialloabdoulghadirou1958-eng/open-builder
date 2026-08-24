import { describe, expect, it } from "vitest";
import { sanitizePendingSecretMigration } from "./vault";

describe("vault pending secret migration", () => {
  it("preserves only the API key from legacy pending records", () => {
    expect(
      sanitizePendingSecretMigration({
        apiKey: "old-key",
        accessToken: "access",
        refreshToken: "refresh",
        tokenExpiresAt: 123,
      }),
    ).toEqual({
      apiKey: "old-key",
    });
  });

  it("drops pending records that only contain authentication tokens", () => {
    expect(
      sanitizePendingSecretMigration({ accessToken: "access" }),
    ).toBeNull();
  });
});
