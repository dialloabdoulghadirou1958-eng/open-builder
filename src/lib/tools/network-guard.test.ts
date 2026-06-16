import { describe, expect, it } from "vitest";
import {
  clampInt,
  limitArray,
  limitRecord,
  mapWithConcurrency,
  truncateText,
} from "./network-guard";

describe("network guard helpers", () => {
  it("clamps numeric tool arguments", () => {
    expect(clampInt(undefined, 5, 1, 10)).toBe(5);
    expect(clampInt("20", 5, 1, 10)).toBe(10);
    expect(clampInt(-1, 5, 1, 10)).toBe(1);
    expect(clampInt(3.8, 5, 1, 10)).toBe(3);
  });

  it("limits arrays and reports truncation", () => {
    const limited = limitArray([1, 2, 3], 2);

    expect(limited.items).toEqual([1, 2]);
    expect(limited.truncated).toBe(true);
    expect(limited.originalCount).toBe(3);
  });

  it("limits records and preserves entry order", () => {
    const limited = limitRecord({ a: 1, b: 2, c: 3 }, 2);

    expect(limited.value).toEqual({ a: 1, b: 2 });
    expect(limited.truncated).toBe(true);
    expect(limited.originalCount).toBe(3);
  });

  it("truncates text and reports original length", () => {
    const result = truncateText("abcdef", 3);

    expect(result.text).toBe("abc");
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(6);
  });

  it("maps with bounded concurrency while preserving order", async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return value * 2;
    });

    expect(result).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
