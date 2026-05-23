import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInput } from "./chat/ChatInput";
import { EmptyState } from "./chat/EmptyState";
import { MessageBubble } from "./chat/MessageBubble";
import { MobilePreview } from "./chat/MobilePreview";
import { GeneratingIndicator } from "./chat/GeneratingIndicator";
import { SettingsWarning } from "./chat/SettingsWarning";
import { SessionList } from "./chat/SessionList";
import { DiffModal } from "./chat/DiffModal";
import {
  RollbackHint,
  RollbackConfirmDialog,
} from "./chat/RollbackConfirmBanner";
import { useMergedMessages } from "../hooks/useMergedMessages";
import { useIsMobile } from "../hooks/useIsMobile";
import { useRollback } from "../hooks/useRollback";
import { findAssistantGroupEnd } from "../lib/utils/message-navigation";
import { useConversationStore } from "../store/conversation";
import { useSettingsStore } from "../store/settings";
import { useSnapshotStore } from "../store/snapshot";
import { useT } from "../i18n";
import type {
  Message,
  ProjectFiles,
  ProjectSnapshot,
  Attachment,
} from "../types";

const EMPTY_SNAPSHOTS: ProjectSnapshot[] = [];

interface ChatInterfaceProps {
  messages: Message[];
  isGenerating: boolean;
  hasValidSettings: boolean;
  onGenerate: (prompt: string, attachments?: Attachment[]) => Promise<void>;
  onStop: () => void;
  onOpenSettings: () => void;
  onSetFiles: (files: ProjectFiles) => void;
  files: ProjectFiles;
  template: string;
  sandpackKey: number;
  isProjectInitialized: boolean;
  onCompressContext: () => Promise<void>;
  onRetry: () => Promise<void>;
  onContinue: () => Promise<void>;
  onReview: () => Promise<void>;
}

export function ChatInterface({
  messages,
  isGenerating,
  hasValidSettings,
  onGenerate,
  onStop,
  onOpenSettings,
  onSetFiles,
  files,
  template,
  sandpackKey,
  isProjectInitialized,
  onCompressContext,
  onRetry,
  onContinue,
  onReview,
}: ChatInterfaceProps) {
  const t = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mergedMessages = useMergedMessages(messages);
  const isMobile = useIsMobile();

  const activeId = useConversationStore((s) => s.activeId);
  const compressFromIndex = useConversationStore((s) =>
    s.activeId
      ? (s.conversations[s.activeId]?.compressedContext?.fromIndex ?? -1)
      : -1,
  );
  const snapshots = useSnapshotStore((s) =>
    activeId ? (s.snapshots[activeId] ?? EMPTY_SNAPSHOTS) : EMPTY_SNAPSHOTS,
  );
  const snapshotMessageIds = useMemo(
    () => new Set(snapshots.map((s) => s.messageId)),
    [snapshots],
  );
  const [diffMessageId, setDiffMessageId] = useState<string | null>(null);

  const {
    rollbackConfirmId,
    setRollbackConfirmId,
    rollbackInfo,
    setRollbackInfo,
    handleRollback,
    flushSnapshotUpdate,
  } = useRollback({
    activeId,
    messages,
    snapshotsLength: snapshots.length,
    onSetFiles,
  });

  const handleSlashCommand = useCallback(
    (cmd: string) => {
      setInput("");
      switch (cmd) {
        case "new":
          useConversationStore.getState().createConversation();
          break;
        case "fork":
          useConversationStore.getState().forkConversation();
          break;
        case "clear":
          useConversationStore.getState().setMessages([]);
          onSetFiles({});
          break;
        case "compact":
          onCompressContext();
          break;
        case "review":
          onReview();
          break;
        case "continue":
          onContinue();
          break;
        case "retry":
          onRetry();
          break;
        case "plan":
          useSettingsStore.getState().togglePlanMode();
          break;
      }
    },
    [onCompressContext, onReview, onRetry, onContinue, onSetFiles],
  );

  const lastAssistantId = useMemo(() => {
    for (let i = mergedMessages.length - 1; i >= 0; i--) {
      if (mergedMessages[i].role === "assistant") return mergedMessages[i].id;
    }
    return null;
  }, [mergedMessages]);

  const handleShowDiff = useCallback((id: string) => setDiffMessageId(id), []);
  const handleRollbackConfirm = useCallback(
    (id: string) => setRollbackConfirmId(id),
    [setRollbackConfirmId],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isGenerating) return;
    if (!hasValidSettings) {
      onOpenSettings();
      return;
    }
    const prompt = input.trim();
    const atts = [...attachments];
    setInput("");
    setAttachments([]);

    flushSnapshotUpdate();

    if (rollbackInfo) {
      const endIdx = findAssistantGroupEnd(messages, rollbackInfo.messageId);
      useConversationStore.getState().setMessages(messages.slice(0, endIdx));
      setRollbackInfo(null);
    }

    await onGenerate(prompt, atts.length > 0 ? atts : undefined);
  };

  return (
    <div className="relative flex flex-col h-full bg-background">
      <ChatHeader
        isGenerating={isGenerating}
        onOpenSettings={onOpenSettings}
        onToggleSessionList={() => setShowSessionList(true)}
      />

      {showSessionList && (
        <div
          className="absolute inset-0 top-0 z-40 backdrop-blur-sm bg-black/20 animate-in fade-in duration-200"
          onClick={() => setShowSessionList(false)}
        >
          <div
            className="h-full w-full max-w-80 bg-background border-r shadow-lg animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <SessionList onClose={() => setShowSessionList(false)} />
          </div>
        </div>
      )}

      <div
        className="flex flex-col flex-1 p-4 pb-0 overflow-y-auto space-y-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {!hasValidSettings && (
          <SettingsWarning onOpenSettings={onOpenSettings} />
        )}

        {messages.length === 0 && hasValidSettings && (
          <EmptyState onSelectSuggestion={setInput} />
        )}

        {mergedMessages.map((msg, mi) => {
          const idx = parseInt(msg.id.split("-").pop()!, 10);
          const showDivider =
            compressFromIndex >= 0 &&
            idx >= compressFromIndex &&
            (mi < 2 ||
              parseInt(mergedMessages[mi - 2].id.split("-").pop()!, 10) <
                compressFromIndex);
          const isLast = msg.id === lastAssistantId;
          return (
            <div key={msg.id}>
              <MessageBubble
                message={msg}
                isGenerating={isLast && isGenerating}
                isLastAssistant={isLast}
                snapshotExists={snapshotMessageIds.has(msg.id)}
                onShowDiff={handleShowDiff}
                onRollback={handleRollbackConfirm}
                onRetry={onRetry}
              />
              {showDivider && (
                <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
                  <div className="flex-1 border-t" />
                  <span>{t.compress.divider}</span>
                  <div className="flex-1 border-t" />
                </div>
              )}
            </div>
          );
        })}

        {isMobile && isProjectInitialized && !isGenerating && (
          <MobilePreview
            files={files}
            template={template}
            sandpackKey={sandpackKey}
          />
        )}

        {isGenerating && <GeneratingIndicator />}

        {rollbackInfo && !isGenerating && (
          <RollbackHint
            label={rollbackInfo.label}
            onDismiss={() => setRollbackInfo(null)}
          />
        )}

        {!isGenerating &&
          messages.length > 0 &&
          typeof messages[messages.length - 1].content === "string" &&
          (messages[messages.length - 1].content as string).includes(
            "context_length_exceeded",
          ) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-700 dark:text-orange-400">
              <span>{t.compress.hint}</span>
              <button
                onClick={() => onCompressContext()}
                className="ml-auto shrink-0 px-2 py-1 rounded bg-orange-500 text-white text-xs hover:bg-orange-600 transition-colors cursor-pointer"
              >
                {t.compress.button}
              </button>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        input={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={onStop}
        isGenerating={isGenerating}
        messages={messages}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSlashCommand={handleSlashCommand}
      />

      {diffMessageId && activeId && (
        <DiffModal
          conversationId={activeId}
          messageId={diffMessageId}
          onClose={() => setDiffMessageId(null)}
        />
      )}

      {rollbackConfirmId && (
        <RollbackConfirmDialog
          onCancel={() => setRollbackConfirmId(null)}
          onConfirm={() => handleRollback(rollbackConfirmId)}
        />
      )}
    </div>
  );
}
