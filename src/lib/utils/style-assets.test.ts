import { describe, expect, it } from "vitest";
import {
  buildStyleAssetPromptSection,
  createStyleAsset,
  normalizeStyleAssetTags,
  parseStyleAssetList,
} from "./style-assets";

describe("style asset utilities", () => {
  it("creates normalized style assets", () => {
    const asset = createStyleAsset({
      id: "style-1",
      name: "  Acme   Calm  ",
      description: "  Quiet dashboard look  ",
      instructions: "  Use restrained contrast.  ",
      tokens: {
        colors: [" #0f172a ", "#0f172a", "#14b8a6"],
        typography: "  compact sans  ",
      },
      tags: [" admin ", "admin", "saas"],
      now: 10,
    });

    expect(asset).toMatchObject({
      id: "style-1",
      name: "Acme Calm",
      description: "Quiet dashboard look",
      instructions: "Use restrained contrast.",
      tokens: {
        colors: ["#0f172a", "#14b8a6"],
        typography: "compact sans",
      },
      tags: ["admin", "saas"],
      enabled: true,
      createdAt: 10,
      updatedAt: 10,
    });
  });

  it("parses delimited form values", () => {
    expect(parseStyleAssetList("#111, #222\n#333，brand")).toEqual([
      "#111",
      "#222",
      "#333",
      "brand",
    ]);
    expect(normalizeStyleAssetTags(["  a  ", "a", "b  b"])).toEqual([
      "a",
      "b b",
    ]);
  });

  it("builds a prompt section from enabled assets only", () => {
    const enabled = createStyleAsset({
      id: "enabled",
      name: "Enabled",
      instructions: "Use glass buttons sparingly.",
      tokens: { colors: ["#111111"], radius: "4px" },
      now: 20,
    });
    const disabled = createStyleAsset({
      id: "disabled",
      name: "Disabled",
      instructions: "Ignore me.",
      enabled: false,
      now: 30,
    });

    const prompt = buildStyleAssetPromptSection([disabled, enabled]);

    expect(prompt).toContain("<style_asset_library>");
    expect(prompt).toContain("### Enabled");
    expect(prompt).toContain("Colors: #111111");
    expect(prompt).toContain("Radius: 4px");
    expect(prompt).not.toContain("Disabled");
  });

  it("returns an empty prompt when no style assets are enabled", () => {
    expect(
      buildStyleAssetPromptSection([
        createStyleAsset({
          id: "disabled",
          name: "Disabled",
          instructions: "Nope",
          enabled: false,
          now: 1,
        }),
      ]),
    ).toBe("");
  });
});
