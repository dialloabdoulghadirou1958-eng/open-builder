import { describe, expect, it } from "vitest";
import {
  redactSensitiveText,
  sanitizeToolResultForHistory,
  serializeToolArgumentsForHistory,
} from "./message-security";

describe("message security", () => {
  it("redacts common credential forms without retaining their values", () => {
    const sentinel = "sentinel-secret-value";
    const text = redactSensitiveText(
      `Authorization: Bearer ${sentinel}\nhttps://example.com?q=1&token=${sentinel}\nAPI_TOKEN=${sentinel}`,
    );

    expect(text).not.toContain(sentinel);
    expect(text).toContain("[REDACTED]");
  });

  it("persists manage_env operations without values", () => {
    const sentinel = "sentinel-secret-value";
    const serialized = serializeToolArgumentsForHistory("manage_env", {
      operations: [
        { target: "env", action: "set", key: "TOKEN", value: sentinel },
      ],
    });

    expect(serialized).not.toContain(sentinel);
    expect(serialized).toContain("[REDACTED]");
  });

  it("omits legacy reads of protected project files", () => {
    const sentinel = "sentinel-secret-value";
    const result = sanitizeToolResultForHistory(
      "read_files",
      JSON.stringify({ paths: [".env"] }),
      `TOKEN=${sentinel}`,
    );

    expect(result).not.toContain(sentinel);
    expect(result).toContain("Protected tool result omitted");
  });
});
