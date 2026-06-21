import { describe, expect, it } from "vitest";
import { isGenerationRunCurrent } from "./run-guard";

describe("generation run guard", () => {
  it("accepts events only for the active conversation and current run", () => {
    expect(isGenerationRunCurrent("a", "a", "a")).toBe(true);
    expect(isGenerationRunCurrent("a", "b", "a")).toBe(false);
    expect(isGenerationRunCurrent("a", "a", "b")).toBe(false);
    expect(isGenerationRunCurrent(null, "a", "a")).toBe(false);
  });
});
