import type { Message } from "../../types";
import { mergeMessages } from "./merge-messages";

export function findAssistantGroupEnd(
  messages: Message[],
  mergedId: string,
): number {
  const startIdx = parseInt(mergedId.replace("assistant-", ""), 10);
  if (isNaN(startIdx) || startIdx >= messages.length) return messages.length;
  let j = startIdx;
  while (
    j < messages.length &&
    (messages[j].role === "assistant" || messages[j].role === "tool")
  ) {
    j++;
  }
  return j;
}

export function findPrecedingUserLabel(
  messages: Message[],
  mergedId: string,
): string {
  const merged = mergeMessages(messages);
  const idx = merged.findIndex((m) => m.id === mergedId);
  if (idx <= 0) return "";
  for (let i = idx - 1; i >= 0; i--) {
    if (merged[i].role === "user") {
      const textBlock = merged[i].blocks.find((b) => b.type === "text");
      if (textBlock && "content" in textBlock) {
        const text = textBlock.content;
        return text.length > 30 ? text.slice(0, 30) + "..." : text;
      }
    }
  }
  return "";
}
