import type { StyleAsset, StyleAssetTokens } from "../../types";

export interface StyleAssetInput {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  tokens?: Partial<StyleAssetTokens>;
  tags?: string[];
  enabled?: boolean;
  now: number;
}

const MAX_TAGS = 8;
const MAX_COLORS = 12;
const MAX_PROMPT_ASSETS = 5;
const MAX_INSTRUCTION_CHARS = 1800;

export function createStyleAsset(input: StyleAssetInput): StyleAsset {
  return {
    id: input.id,
    name: sanitizeStyleAssetName(input.name),
    description: normalizeOptionalText(input.description),
    instructions: normalizeInstructions(input.instructions),
    tokens: normalizeStyleAssetTokens(input.tokens ?? {}),
    tags: normalizeStyleAssetTags(input.tags ?? []),
    enabled: input.enabled ?? true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function normalizeStyleAssetTokens(
  tokens: Partial<StyleAssetTokens>,
): StyleAssetTokens {
  return {
    colors: normalizeStyleAssetList(tokens.colors ?? [], MAX_COLORS),
    typography: normalizeOptionalText(tokens.typography),
    radius: normalizeOptionalText(tokens.radius),
    spacing: normalizeOptionalText(tokens.spacing),
  };
}

export function normalizeStyleAssetTags(tags: string[]): string[] {
  return normalizeStyleAssetList(tags, MAX_TAGS);
}

export function sanitizeStyleAssetName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed || "Untitled Style";
}

export function parseStyleAssetList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildStyleAssetPromptSection(assets: StyleAsset[]): string {
  const enabled = assets
    .filter((asset) => asset.enabled)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PROMPT_ASSETS);

  if (enabled.length === 0) return "";

  const blocks = enabled
    .map((asset) => {
      const parts = [
        `### ${asset.name}`,
        asset.description ? `Description: ${asset.description}` : "",
        asset.tags.length > 0 ? `Tags: ${asset.tags.join(", ")}` : "",
        asset.tokens.colors.length > 0
          ? `Colors: ${asset.tokens.colors.join(", ")}`
          : "",
        asset.tokens.typography ? `Typography: ${asset.tokens.typography}` : "",
        asset.tokens.radius ? `Radius: ${asset.tokens.radius}` : "",
        asset.tokens.spacing ? `Spacing: ${asset.tokens.spacing}` : "",
        `Instructions:\n${truncate(asset.instructions, MAX_INSTRUCTION_CHARS)}`,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");

  return `\n\n<style_asset_library>
The user has enabled the following reusable brand/style assets. Treat them as
binding visual direction for UI work unless the current user request explicitly
conflicts with them. Preserve accessibility and responsive behavior while
applying these colors, typography notes, spacing/radius preferences and design
instructions.

${blocks}
</style_asset_library>`;
}

function normalizeStyleAssetList(values: string[], maxItems: number): string[] {
  const normalized = values
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, maxItems);
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : undefined;
}

function normalizeInstructions(value: string) {
  const trimmed = value.trim();
  return trimmed || "Use this style asset as the primary visual direction.";
}

function truncate(value: string, maxChars: number) {
  return value.length > maxChars
    ? `${value.slice(0, maxChars)}\n[truncated]`
    : value;
}
