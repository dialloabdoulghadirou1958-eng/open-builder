import { memo, useEffect, useRef, useState } from "react";
import {
  Trash2,
  Pencil,
  Check,
  X,
  EllipsisVertical,
  Pin,
  Archive,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT } from "../../../i18n";
import type { Conversation } from "../../../types";

export interface SessionItemProps {
  conv: Conversation;
  isActive: boolean;
  isSmartRenaming: boolean;
  displayTitle: (conv: Conversation) => string;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSmartRename: (convId: string) => void;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  archive: (id: string) => void;
  unarchive: (id: string) => void;
  onDelete: (id: string) => void;
  deleteDisabled: boolean;
  defaultEditValue: string;
}

export const SessionItem = memo(function SessionItem({
  conv,
  isActive,
  isSmartRenaming,
  displayTitle,
  onSelect,
  onRename,
  onSmartRename,
  pin,
  unpin,
  archive,
  unarchive,
  onDelete,
  deleteDisabled,
  defaultEditValue,
}: SessionItemProps) {
  const t = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const startEdit = () => {
    setEditingTitle(defaultEditValue);
    setIsEditing(true);
  };

  const commitEdit = () => {
    const next = editingTitle.trim();
    if (next) onRename(conv.id, next);
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div
      className={cn(
        "flex items-center h-14 gap-2 px-3 cursor-pointer hover:bg-muted/50 group",
        isActive && "bg-muted",
      )}
      onClick={() => {
        if (!isEditing) onSelect(conv.id);
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          className="text-sm flex-1 bg-transparent border-b border-primary outline-none min-w-0"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={cn(
            "text-sm truncate flex-1",
            isSmartRenaming && "animate-pulse",
          )}
        >
          {displayTitle(conv)}
        </span>
      )}

      {isEditing ? (
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              commitEdit();
            }}
          >
            <Check size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              cancelEdit();
            }}
          >
            <X size={12} />
          </Button>
        </div>
      ) : (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <EllipsisVertical size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {conv.pinned ? (
                <DropdownMenuItem onSelect={() => unpin(conv.id)}>
                  <Pin size={14} className="rotate-45" />
                  {t.sessions.unpin}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => pin(conv.id)}>
                  <Pin size={14} />
                  {t.sessions.pin}
                </DropdownMenuItem>
              )}
              {conv.archived ? (
                <DropdownMenuItem onSelect={() => unarchive(conv.id)}>
                  <Archive size={14} />
                  {t.sessions.unarchive}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => archive(conv.id)}>
                  <Archive size={14} />
                  {t.sessions.archive}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={startEdit}>
                <Pencil size={14} />
                {t.sessions.rename}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onSmartRename(conv.id)}
                disabled={conv.messages.length === 0}
              >
                <Sparkles size={14} />
                {t.sessions.smartRename}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(conv.id)}
                disabled={deleteDisabled}
              >
                <Trash2 size={14} />
                {t.sessions.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
});
