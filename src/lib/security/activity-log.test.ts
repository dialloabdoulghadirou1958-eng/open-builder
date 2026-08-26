// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPermissionActivity,
  getPermissionActivity,
  recordPermissionActivity,
} from "./activity-log";

describe("permission activity log", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    clearPermissionActivity();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps only an origin and redacts credential-like reason text", () => {
    recordPermissionActivity({
      tool: "mcp_demo_search",
      source: "mcp",
      mode: "chat",
      platform: "desktop",
      decision: "denied",
      target: "https://api.example.com/private?token=secret-value",
      reason: "Authorization: Bearer top-secret?key=also-secret",
    });

    const [entry] = getPermissionActivity();
    expect(entry.target).toBe("https://api.example.com");
    expect(entry.reason).toContain("Bearer [REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("top-secret");
    expect(JSON.stringify(entry)).not.toContain("also-secret");
  });

  it("bounds the local history", () => {
    for (let index = 0; index < 220; index += 1) {
      recordPermissionActivity({
        tool: `tool-${index}`,
        source: "builtin",
        mode: "chat",
        platform: "web",
        decision: "allowed",
      });
    }

    const entries = getPermissionActivity();
    expect(entries).toHaveLength(200);
    expect(entries[0].tool).toBe("tool-20");
    expect(entries.at(-1)?.tool).toBe("tool-219");
  });
});
