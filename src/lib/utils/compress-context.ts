import { generateText } from "ai";
import type { Message } from "../ai/generator";
import type { CompressedContext, ProjectFiles } from "../../types";
import type { ProviderConfig } from "../ai/provider";
import { getProviderModel } from "../ai/provider";
import { buildProjectFilesPromptListing } from "./project-files";

export interface CompressResult {
  summary: string;
  fromIndex: number;
}

export const COMPRESSED_CONTEXT_LIMITS = {
  maxSummaryChars: 80_000,
} as const;

const TOOL_RESULT_MAX_CHARS = 600;

function truncateForSummary(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `... [truncated ${text.length - max} chars]`;
}

export function normalizeCompressedSummary(summary: string): string {
  if (summary.length <= COMPRESSED_CONTEXT_LIMITS.maxSummaryChars) {
    return summary;
  }
  return (
    summary.slice(0, COMPRESSED_CONTEXT_LIMITS.maxSummaryChars) +
    `\n\n[compressed context truncated after ${COMPRESSED_CONTEXT_LIMITS.maxSummaryChars} chars]`
  );
}

function formatMessageForSummary(m: Message): string | null {
  if (m.role === "system") return null;

  if (m.role === "tool") {
    const body =
      typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content);
    return `tool_result: ${truncateForSummary(body, TOOL_RESULT_MAX_CHARS)}`;
  }

  const body =
    typeof m.content === "string"
      ? m.content
      : m.content == null
        ? ""
        : JSON.stringify(m.content);

  if (m.role === "assistant" && m.tool_calls?.length) {
    const calls = m.tool_calls
      .map((tc) => {
        const args = truncateForSummary(tc.function.arguments ?? "", 200);
        return `${tc.function.name}(${args})`;
      })
      .join(", ");
    return body
      ? `assistant: ${body}\nassistant_tool_calls: ${calls}`
      : `assistant_tool_calls: ${calls}`;
  }

  return `${m.role}: ${body}`;
}

function buildFileInventory(files: ProjectFiles | undefined): string {
  if (!files) return "";
  const listing = buildProjectFilesPromptListing(files);
  return listing.includes("The project is empty") ? "" : listing;
}

export async function compressContext(
  messages: Message[],
  cfg: ProviderConfig,
  existingContext?: CompressedContext,
  files?: ProjectFiles,
): Promise<CompressResult | null> {
  const userIndices = messages.reduce<number[]>((acc, m, i) => {
    if (m.role === "user") acc.push(i);
    return acc;
  }, []);
  if (userIndices.length < 2) return null;

  const fromIndex = userIndices[userIndices.length - 1];
  if (fromIndex <= 0) return null;

  let text: string;
  if (existingContext && existingContext.fromIndex > 0) {
    const newer = messages
      .slice(existingContext.fromIndex, fromIndex)
      .map(formatMessageForSummary)
      .filter((line): line is string => line !== null)
      .join("\n");
    text = `[Previous summary]\n${existingContext.summary}\n\n[Recent conversation]\n${newer}`;
  } else {
    const older = messages.slice(0, fromIndex);
    text = older
      .map(formatMessageForSummary)
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  const providerModel = getProviderModel(cfg);

  const result = await generateText({
    model: providerModel,
    messages: [
      {
        role: "system",
        content:
          "Summarize the following conversation concisely. Focus on: what the user requested, what was built/modified, key tool operations (files read/written, searches run, results), key decisions, and current project state. Be brief but preserve all information needed to continue.",
      },
      { role: "user", content: [{ type: "text", text }] },
    ],
  });

  const summary = normalizeCompressedSummary(
    (result.text || "") + buildFileInventory(files),
  );

  return { summary, fromIndex };
}
