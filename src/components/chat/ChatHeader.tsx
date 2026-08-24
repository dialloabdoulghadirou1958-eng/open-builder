import { History, PanelLeftOpen, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversationStore, DEFAULT_TITLE } from "../../store/conversation";
import { useT } from "../../i18n";

interface ChatHeaderProps {
  isGenerating: boolean;
  onOpenSettings: () => void;
  onToggleSessionList: () => void;
  onOpenSnapshotHistory: () => void;
  snapshotCount: number;
}

export function ChatHeader({
  onOpenSettings,
  onToggleSessionList,
  onOpenSnapshotHistory,
  snapshotCount,
}: ChatHeaderProps) {
  const t = useT();
  const rawTitle = useConversationStore((s) =>
    s.activeId ? (s.conversations[s.activeId]?.title ?? null) : null,
  );
  const title =
    !rawTitle || rawTitle === DEFAULT_TITLE ? t.chat.newApp : rawTitle;

  return (
    <div className="h-14 px-3 border-b bg-background flex items-center justify-between shrink-0">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSessionList}
        title={t.header.sessions}
        className="h-8 w-8 shrink-0"
      >
        <PanelLeftOpen size={18} />
      </Button>
      <span className="text-sm font-medium truncate px-2 flex-1 text-center">
        {title}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSnapshotHistory}
          disabled={snapshotCount === 0}
          title={t.snapshots.open}
          className="h-8 w-8 shrink-0"
        >
          <History size={18} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          title={t.header.settings}
          className="h-8 w-8 shrink-0"
        >
          <Settings size={18} />
        </Button>
      </div>
    </div>
  );
}
