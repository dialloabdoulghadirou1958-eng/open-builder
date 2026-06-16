import { describe, expect, it } from "vitest";
import {
  isHostAllowed,
  parseProxyAllowedHosts,
} from "./proxy";

describe("proxy allowlist helpers", () => {
  it("parses comma and newline separated hosts", () => {
    expect(
      parseProxyAllowedHosts("api.openai.com, *.anthropic.com\nLOCALHOST"),
    ).toEqual(["api.openai.com", "*.anthropic.com", "localhost"]);
  });

  it("allows only loopback hosts when the allowlist is empty", () => {
    expect(isHostAllowed("localhost", [])).toBe(true);
    expect(isHostAllowed("127.0.0.1", [])).toBe(true);
    expect(isHostAllowed("::1", [])).toBe(true);
    expect(isHostAllowed("api.example.com", [])).toBe(false);
  });

  it("matches exact hosts and wildcard subdomains", () => {
    expect(
      isHostAllowed("api.openai.com", ["api.openai.com", "*.example.com"]),
    ).toBe(true);
    expect(isHostAllowed("cdn.example.com", ["*.example.com"])).toBe(true);
    expect(isHostAllowed("example.com", ["*.example.com"])).toBe(false);
    expect(isHostAllowed("api.other.com", ["*.example.com"])).toBe(false);
  });
});
