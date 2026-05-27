import { useState, useEffect, memo } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  ChevronDown,
  ChevronRight,
  Lightbulb,
  GitCompareArrows,
  Undo2,
  RefreshCw,
  FileText,
  Check,
  Copy,
} from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";
import { ToolCallCard } from "./ToolCallCard";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { SubagentCallCard } from "./SubagentCallCard";
import { useT } from "../../i18n";
import type { AskUserQuestion } from "../../store/interactive";
import type {
  MergedMessage,
  TextBlock,
  ImageBlock,
  FileBlock,
} from "../../types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : "";
}

interface MessageBubbleProps {
  message: MergedMessage;
  isGenerating?: boolean;
  isLastAssistant?: boolean;
  snapshotExists?: boolean;
  onShowDiff?: (messageId: string) => void;
  onRollback?: (messageId: string) => void;
  onRetry?: () => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isGenerating = false,
  isLastAssistant = false,
  snapshotExists = false,
  onShowDiff,
  onRollback,
  onRetry,
}: MessageBubbleProps) {
  const t = useT();
  if (message.role === "user") {
    const textBlocks = message.blocks.filter(
      (b): b is TextBlock => b.type === "text",
    );
    const imageBlocks = message.blocks.filter(
      (b): b is ImageBlock => b.type === "image",
    );
    const fileBlocks = message.blocks.filter(
      (b): b is FileBlock => b.type === "file",
    );

    return (
      <div className="flex justify-end">
        <div className="bg-secondary px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%]">
          {imageBlocks.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {imageBlocks.map((img) => (
                <img
                  key={img.id}
                  src={img.url}
                  alt=""
                  className="max-w-48 max-h-48 rounded-lg object-cover"
                />
              ))}
            </div>
          )}
          {fileBlocks.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2">
              {fileBlocks.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/60 bg-neutral-200 dark:bg-neutral-700 max-w-64"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 shrink-0">
                    <FileText size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-xs font-medium line-clamp-2"
                      title={f.name}
                    >
                      {f.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {getFileExt(f.name)}
                      {getFileExt(f.name) && " · "}
                      {f.size > 0 ? formatFileSize(f.size) : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {textBlocks.length > 0 && (
            <MarkdownContent
              content={textBlocks.map((b) => b.content).join("\n\n")}
              variant="user"
            />
          )}
        </div>
      </div>
    );
  }

  // Prefer the structured isError flag carried on the merged message.
  // Fall back to scanning the leading "⚠️" prefix for backward compatibility
  // with messages persisted before the flag existed.
  const isError =
    message.isError ??
    message.blocks.some(
      (b) => b.type === "text" && b.content.startsWith("⚠️"),
    );

  const assistantText = message.blocks
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.content)
    .join("\n\n")
    .trim();

  return (
    <div className="flex-1 min-w-0 space-y-2">
      {message.blocks.map((block) => {
        if (block.type === "thinking") {
          return (
            <ThinkingBlockCard
              key={block.id}
              content={block.content}
              isStreaming={isGenerating && isLastAssistant}
            />
          );
        }
        if (block.type === "text") {
          return (
            <div key={block.id} className="text-sm text-foreground">
              <MarkdownContent content={block.content} variant="assistant" />
            </div>
          );
        }
        if (block.type === "tool") {
          if (block.toolName === "exit_plan_mode") {
            return (
              <PlanApprovalCard
                key={block.id}
                toolCallId={block.toolCallId}
                plan={
                  typeof block.rawArgs?.plan === "string"
                    ? (block.rawArgs.plan as string)
                    : ""
                }
                result={block.result}
              />
            );
          }
          if (block.toolName === "ask_user_question") {
            const rawQuestions = block.rawArgs?.questions;
            const questions = Array.isArray(rawQuestions)
              ? (rawQuestions as AskUserQuestion[])
              : [];
            return (
              <AskUserQuestionCard
                key={block.id}
                toolCallId={block.toolCallId}
                questions={questions}
                result={block.result}
              />
            );
          }
          if (block.toolName === "dispatch_subagent") {
            return <SubagentCallCard key={block.id} {...block} />;
          }
          return <ToolCallCard key={block.id} {...block} />;
        }
        return null;
      })}
      {(snapshotExists || isError || assistantText) &&
        !(isGenerating && isLastAssistant) && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
            {snapshotExists && (
              <>
                <button
                  onClick={() => onShowDiff?.(message.id)}
                  aria-label={t.diff.showDiff}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <GitCompareArrows className="w-3.5 h-3.5" />
                  <span>{t.diff.showDiff}</span>
                </button>
                <button
                  onClick={() => onRollback?.(message.id)}
                  aria-label={t.message.rollback}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>{t.message.rollback}</span>
                </button>
              </>
            )}
            {assistantText && !isError && (
              <CopyMessageButton text={assistantText} />
            )}
            {isError && onRetry && (
              <button
                onClick={() => onRetry()}
                aria-label={t.message.retry}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.message.retry}</span>
              </button>
            )}
          </div>
        )}
    </div>
  );
});

function CopyMessageButton({ text }: { text: string }) {
  const t = useT();
  const [copied, copy] = useCopyToClipboard();

  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={copied ? t.message.copied : t.message.copy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      <span>{copied ? t.message.copied : t.message.copy}</span>
    </button>
  );
}

function ThinkingBlockCard({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(isStreaming);

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming) setExpanded(false);
  }, [isStreaming]);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={t.message.thinking}
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <Lightbulb className="w-3.5 h-3.5 text-purple-500" />
        <span className="font-medium text-xs text-foreground">
          {t.message.thinking}
        </span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="thought px-3 py-2 text-xs text-muted-foreground max-h-60 overflow-y-auto">
          <MarkdownContent content={content} variant="assistant" />
        </div>
      )}
    </div>
  );
}
