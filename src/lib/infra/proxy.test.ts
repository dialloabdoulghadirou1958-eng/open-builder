import { describe, expect, it } from "vitest";
import {
  isHostAllowed,
  normalizeProxyHostRule,
  parseProxyAllowedHosts,
} from "./proxy";

describe("proxy allowlist helpers", () => {
  it("parses comma and newline separated hosts", () => {
    expect(
      parseProxyAllowedHosts("api.openai.com, *.anthropic.com\nLOCALHOST"),
    ).toEqual(["api.openai.com", "*.anthropic.com", "localhost"]);
  });

  it("normalizes pasted URLs, ports and invalid entries", () => {
    expect(normalizeProxyHostRule("https://api.openai.com/v1")).toBe(
      "api.openai.com",
    );
    expect(normalizeProxyHostRule("localhost:11434")).toBe("localhost");
    expect(normalizeProxyHostRule("[::1]")).toBe("::1");
    expect(normalizeProxyHostRule("*.example.com")).toBe("*.example.com");
    expect(normalizeProxyHostRule("*.bad_host")).toBeNull();
    expect(normalizeProxyHostRule("https://")).toBeNull();

    expect(
      parseProxyAllowedHosts(
        "https://api.openai.com/v1, api.openai.com, *.bad_host",
      ),
    ).toEqual(["api.openai.com"]);
  });

  it("caps allowlist rule count", () => {
    const rules = Array.from({ length: 80 }, (_, i) => `h${i}.example.com`);
    expect(parseProxyAllowedHosts(rules.join(","))).toHaveLength(64);
  });

  it("allows only loopback hosts when the allowlist is empty", () => {
    expect(isHostAllowed("localhost", [])).toBe(true);
    expect(isHostAllowed("127.0.0.1", [])).toBe(true);
    expect(isHostAllowed("127.0.0.2", [])).toBe(true);
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
