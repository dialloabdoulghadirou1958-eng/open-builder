import { generateText } from "ai";
import type { Message } from "../ai/generator";
import type { CompressedContext } from "../../types";
import type { ProviderConfig } from "../ai/provider";
import { getProviderModel } from "../ai/provider";

export interface CompressResult {
  summary: string;
  fromIndex: number;
}

export async function compressContext(
  messages: Message[],
  cfg: ProviderConfig,
  existingContext?: CompressedContext,
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
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(
        (m) =>
          `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
      )
      .join("\n");
    text = `[Previous summary]\n${existingContext.summary}\n\n[Recent conversation]\n${newer}`;
  } else {
    const older = messages.slice(0, fromIndex);
    text = older
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(
        (m) =>
          `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
      )
      .join("\n");
  }

  const providerModel = getProviderModel(cfg);

  const result = await generateText({
    model: providerModel,
    messages: [
      {
        role: "system",
        content:
          "Summarize the following conversation concisely. Focus on: what the user requested, what was built/modified, key decisions, and current project state. Be brief but preserve all information needed to continue.",
      },
      { role: "user", content: [{ type: "text", text }] },
    ],
  });

  const summary = result.text || "";

  return { summary, fromIndex };
}
