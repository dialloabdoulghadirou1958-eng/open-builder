import { describe, expect, it } from "vitest";
import {
  normalizeToolResultForModel,
  TOOL_RESULT_LIMITS,
} from "./tool-result";

describe("normalizeToolResultForModel", () => {
  it("leaves small tool results untouched", () => {
    expect(normalizeToolResultForModel("OK").result).toBe("OK");
    expect(normalizeToolResultForModel("OK").truncated).toBe(false);
  });

  it("truncates oversized tool results before feeding them back to the model", () => {
    const normalized = normalizeToolResultForModel(
      "x".repeat(TOOL_RESULT_LIMITS.maxModelResultChars + 10),
    );

    expect(normalized.truncated).toBe(true);
    expect(normalized.result).toContain("[tool result truncated after");
    expect(normalized.result.length).toBeLessThan(
      TOOL_RESULT_LIMITS.maxModelResultChars + 100,
    );
  });
});
