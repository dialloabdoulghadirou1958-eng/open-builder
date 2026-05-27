import type { ProviderConfig } from "../ai/provider";
import type { Conversation } from "../../types";
import { compressContext, type CompressResult } from "./compress-context";
import { useConversationStore } from "../../store/conversation";

export async function runCompress(
  cfg: ProviderConfig,
  conv: Conversation,
): Promise<CompressResult | null> {
  const result = await compressContext(
    conv.messages,
    cfg,
    conv.compressedContext,
    conv.files,
  );
  if (result) {
    useConversationStore.getState().setCompressedContext(result);
  }
  return result;
}
