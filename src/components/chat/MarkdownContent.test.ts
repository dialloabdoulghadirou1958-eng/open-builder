import { describe, expect, it } from "vitest";
import {
  normalizeMarkdownHref,
  normalizeMarkdownImageSrc,
} from "./MarkdownContent";

describe("MarkdownContent URL guards", () => {
  it("allows only explicit safe link targets", () => {
    expect(normalizeMarkdownHref("https://example.com/a b")).toBe(
      "https://example.com/a%20b",
    );
    expect(normalizeMarkdownHref("mailto:hello@example.com")).toBe(
      "mailto:hello@example.com",
    );
    expect(normalizeMarkdownHref("#section")).toBe("#section");
    expect(normalizeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(normalizeMarkdownHref("/settings")).toBeUndefined();
  });

  it("allows http images and bounded raster data URLs only", () => {
    expect(normalizeMarkdownImageSrc("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
    expect(
      normalizeMarkdownImageSrc("data:image/png;base64,aGVsbG8="),
    ).toBe("data:image/png;base64,aGVsbG8=");
    expect(
      normalizeMarkdownImageSrc(
        "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
      ),
    ).toBeUndefined();
    expect(
      normalizeMarkdownImageSrc(
        `data:image/png;base64,${"a".repeat(2 * 1024 * 1024)}`,
      ),
    ).toBeUndefined();
  });
});
