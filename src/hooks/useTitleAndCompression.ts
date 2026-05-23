import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { runCompress } from "../lib/utils/run-compress";
import { generateSmartTitle } from "../lib/utils/smart-title";
import { useConversationStore, DEFAULT_TITLE } from "../store/conversation";
import type { ProviderConfig } from "../lib/ai/provider";
import type { Message } from "../types";

interface UseTitleAndCompressionArgs {
  /** Returns the *effective* provider config — refresh tokens / merge mohua routing before resolving. */
  resolveConfig: () => Promise<ProviderConfig>;
  setIsGenerating: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

export function useTitleAndCompression({
  resolveConfig,
  setIsGenerating,
  setMessages,
}: UseTitleAndCompressionArgs) {
  const triggerSmartTitle = useCallback((cfg: ProviderConfig) => {
    const convState = useConversationStore.getState();
    const conv = convState.activeId
      ? convState.conversations[convState.activeId]
      : null;
    if (!conv || conv.title !== DEFAULT_TITLE) return;

    generateSmartTitle(conv.messages, cfg)
      .then((title) => {
        if (!title) return;
        const current = useConversationStore.getState();
        const currentConv = current.conversations[conv.id];
        if (currentConv && currentConv.title === DEFAULT_TITLE) {
          useConversationStore.getState().renameConversation(conv.id, title);
        }
      })
      .catch(() => {});
  }, []);

  const compressContext = useCallback(async () => {
    const storeState = useConversationStore.getState();
    const conv = storeState.activeId
      ? storeState.conversations[storeState.activeId]
      : null;
    if (!conv) return;

    setIsGenerating(true);
    try {
      const cfg = await resolveConfig();
      await runCompress(cfg, conv);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `${err?.message || "Compression failed"}`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  }, [resolveConfig, setMessages, setIsGenerating]);

  return { triggerSmartTitle, compressContext };
}
