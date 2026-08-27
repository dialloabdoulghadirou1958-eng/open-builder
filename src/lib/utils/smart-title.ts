import { generateText } from "ai";
import type { Message } from "../ai/generator";
import type { ProviderConfig } from "../ai/provider";
import { getProviderModel } from "../ai/provider";

export async function generateSmartTitle(
  messages: Message[],
  cfg: ProviderConfig,
  generateTextOverride?: (
    instructions: string,
    prompt: string,
  ) => Promise<string>,
): Promise<string | null> {
  const hasUser = messages.some(
    (m) => m.role === "user" && m.metadata?.origin !== "auto_qa",
  );
  const hasAssistant = messages.some((m) => m.role === "assistant");
  if (!hasUser || !hasAssistant) return null;

  const relevant = messages
    .filter(
      (m) =>
        m.role === "assistant" ||
        (m.role === "user" && m.metadata?.origin !== "auto_qa"),
    )
    .slice(0, 6)
    .map((m) => {
      const text =
        typeof m.content === "string"
          ? m.content
          : ((m.content as any[])?.find((p: any) => p.type === "text")?.text ??
            "");
      return `${m.role}: ${text.slice(0, 200)}`;
    })
    .join("\n");

  try {
    const instructions =
      "Title this development conversation in 4-12 words, naming the app or task being built. " +
      "Write it in the language the user is using. " +
      "Output the title alone — no quotes, no explanation, no trailing punctuation.";
    const title = generateTextOverride
      ? (await generateTextOverride(instructions, relevant)).trim()
      : (
          await generateText({
            model: getProviderModel(cfg),
            instructions,
            prompt: relevant,
          })
        ).text?.trim() || "";

    if (!title || title.length > 80) return null;
    return title;
  } catch {
    return null;
  }
}
