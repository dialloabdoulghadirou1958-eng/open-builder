import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../i18n";
import { useSettingsStore } from "../../store/settings";
import type { Attachment } from "../../types";
import type { Message } from "../../lib/ai/generator-types";
import {
  SLASH_COMMANDS,
  SlashCommandMenu,
  type SlashCommand,
} from "./chat-input/SlashCommandMenu";
import { AttachmentPreview } from "./chat-input/AttachmentPreview";
import { ChatInputToolbar } from "./chat-input/ChatInputToolbar";
import { SkillsPanel } from "../skills/SkillsPanel";
import { isSkillsAvailable } from "../../lib/skills/fs";

const NEEDS_MESSAGES = new Set([
  "fork",
  "clear",
  "compact",
  "review",
  "continue",
  "retry",
]);

const FILE_ACCEPT =
  "text/*,application/json,application/xml,application/javascript,application/xhtml+xml,application/x-yaml,application/sql,application/graphql,application/ld+json,application/x-sh,application/x-httpd-php,application/typescript,application/pdf";

const FILE_MIME_PREFIXES = ["text/"];
const FILE_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/xhtml+xml",
  "application/x-yaml",
  "application/sql",
  "application/graphql",
  "application/ld+json",
  "application/x-sh",
  "application/x-httpd-php",
  "application/typescript",
  "application/pdf",
]);

function isAcceptedFileType(mime: string): boolean {
  if (FILE_MIME_EXACT.has(mime)) return true;
  return FILE_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

function isImageType(mime: string): boolean {
  return mime.startsWith("image/");
}

interface ChatInputProps {
  input: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onStop: () => void;
  isGenerating: boolean;
  messages: Message[];
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onSlashCommand: (cmd: string) => void;
}

export function ChatInput({
  input,
  onChange,
  onSubmit,
  onStop,
  isGenerating,
  messages,
  attachments,
  onAttachmentsChange,
  onSlashCommand,
}: ChatInputProps) {
  const t = useT();
  const planModeEnabled = useSettingsStore((s) => s.system.planModeEnabled);
  const setPlanMode = useSettingsStore((s) => s.setPlanMode);
  const [isHoveringStop, setIsHoveringStop] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const skillsAvailable = isSkillsAvailable();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  const slashMatch = /^\/(\S*)$/.exec(input);

  const hasMessages = messages.length > 0;
  const lastMsg = hasMessages ? messages[messages.length - 1] : null;
  const lastIsError =
    lastMsg?.role === "assistant" &&
    typeof lastMsg.content === "string" &&
    lastMsg.content.startsWith("⚠️");

  const filteredCmds = useMemo<SlashCommand[]>(() => {
    if (!slashMatch) return [];
    const q = slashMatch[1].toLowerCase();
    return SLASH_COMMANDS.filter((c) => {
      if (!c.startsWith(q)) return false;
      if (NEEDS_MESSAGES.has(c) && !hasMessages) return false;
      if (c === "retry") return lastIsError;
      if (c === "continue") return hasMessages && !lastIsError;
      return true;
    });
  }, [slashMatch?.[1], hasMessages, lastIsError]);
  const showSlashMenu = filteredCmds.length > 0 && !isGenerating;

  useEffect(() => {
    setSelectedIdx(0);
  }, [filteredCmds.length]);

  useEffect(() => {
    const menu = slashMenuRef.current;
    if (!menu) return;
    const item = menu.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filteredCmds.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx(
          (i) => (i - 1 + filteredCmds.length) % filteredCmds.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSlashCommand(filteredCmds[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onChange("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.closest("form");
      if (form) form.requestSubmit();
    }
  };

  const processFile = useCallback(
    (file: File) => {
      if (isImageType(file.type)) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            onAttachmentsChange([
              ...attachments,
              {
                type: "image",
                name: file.name || "pasted-image",
                content: reader.result,
                size: file.size,
              },
            ]);
          }
        };
        reader.readAsDataURL(file);
      } else if (isAcceptedFileType(file.type)) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            onAttachmentsChange([
              ...attachments,
              {
                type: "file",
                name: file.name,
                content: reader.result,
                size: file.size,
              },
            ]);
          }
        };
        if (file.type === "application/pdf") {
          reader.readAsDataURL(file);
        } else {
          reader.readAsText(file);
        }
      }
    },
    [attachments, onAttachmentsChange],
  );

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (isImageType(item.type)) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          return;
        }
      }
      if (isAcceptedFileType(item.type)) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          return;
        }
      }
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(processFile);
    e.target.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(processFile);
    e.target.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (isImageType(file.type) || isAcceptedFileType(file.type)) {
        processFile(file);
      }
    });
  };

  const removeAttachment = (index: number) => {
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
  };

  const hasContent = input.trim() || attachments.length > 0;

  return (
    <div
      className={`p-2 bg-background shrink-0 transition-colors ${isDragOver ? "ring-2 ring-primary/50 ring-inset rounded-lg bg-primary/5" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <form onSubmit={onSubmit}>
        <AttachmentPreview
          attachments={attachments}
          onRemove={removeAttachment}
        />
        <div className="relative">
          {showSlashMenu && (
            <SlashCommandMenu
              ref={slashMenuRef}
              commands={filteredCmds}
              selectedIdx={selectedIdx}
              onSelect={(cmd) => onSlashCommand(cmd)}
              onHoverIdx={setSelectedIdx}
            />
          )}

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageSelect}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          <div className="border border-input rounded-lg bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                onChange(e.target.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t.chat.placeholder}
              rows={2}
              disabled={isGenerating}
              className="border-0 shadow-none focus-visible:ring-0 focus-visible:border-0 resize-none overflow-y-auto bg-transparent px-3 py-2 md:text-base min-h-0 field-sizing-fixed"
              style={{ maxHeight: 200 }}
            />
            <ChatInputToolbar
              onPickImage={() => imageInputRef.current?.click()}
              onPickFile={() => fileInputRef.current?.click()}
              onManageSkills={
                skillsAvailable ? () => setSkillsOpen(true) : undefined
              }
              skillsAvailable={skillsAvailable}
              planModeEnabled={planModeEnabled}
              setPlanMode={setPlanMode}
              isGenerating={isGenerating}
              hasContent={Boolean(hasContent)}
              isHoveringStop={isHoveringStop}
              onHoveringStopChange={setIsHoveringStop}
              onStop={onStop}
            />
          </div>
        </div>
      </form>
      {skillsAvailable && (
        <SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      )}
    </div>
  );
}
