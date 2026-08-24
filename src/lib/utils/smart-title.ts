import { generateText } from "ai";
import type { Message } from "../ai/generator";
import type { ProviderConfig } from "../ai/provider";
import { getProviderModel } from "../ai/provider";

export async function generateSmartTitle(
  messages: Message[],
  cfg: ProviderConfig,
): Promise<string | null> {
  const hasUser = messages.some((m) => m.role === "user");
  const hasAssistant = messages.some((m) => m.role === "assistant");
  if (!hasUser || !hasAssistant) return null;

  const relevant = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
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
    const providerModel = getProviderModel(cfg);

    const result = await generateText({
      model: providerModel,
      instructions:
        "Generate a concise title (4-12 words) for this development conversation. " +
        "The title should describe the app or task being built. " +
        "Use the same language as the user's message. " +
        "Return ONLY the title text, no quotes, no explanation, no punctuation at the end.",
      prompt: relevant,
    });

    const title = result.text?.trim() || "";

    if (!title || title.length > 80) return null;
    return title;
  } catch {
    return null;
  }
}
