import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTokenResponse, truncateSsoErrorText } from "./sso";

afterEach(() => {
  vi.useRealTimers();
});

describe("SSO token parsing", () => {
  it("requires an access token", () => {
    expect(() => parseTokenResponse({ expires_in: 3600 })).toThrow(
      "access_token",
    );
  });

  it("normalizes token TTL bounds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    expect(
      parseTokenResponse({ access_token: "token", expires_in: 1 }).expiresAt,
    ).toBe(61_000);
    expect(
      parseTokenResponse({ access_token: "token", expires_in: "120" })
        .expiresAt,
    ).toBe(121_000);
  });

  it("omits invalid refresh tokens", () => {
    expect(
      parseTokenResponse({
        access_token: "token",
        refresh_token: "",
        expires_in: 3600,
      }).refreshToken,
    ).toBeUndefined();
  });

  it("truncates oversized SSO error text", () => {
    const result = truncateSsoErrorText("x".repeat(600));

    expect(result).toHaveLength(500 + " [truncated]".length);
    expect(result.endsWith("[truncated]")).toBe(true);
  });
});
