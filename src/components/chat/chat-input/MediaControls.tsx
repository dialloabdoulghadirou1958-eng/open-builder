import { Image, FileText, Paperclip, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "../../../i18n";

interface MediaControlsProps {
  onPickImage: () => void;
  onPickFile: () => void;
  planModeEnabled: boolean;
  togglePlanMode: () => void;
}

export function MediaControls({
  onPickImage,
  onPickFile,
  planModeEnabled,
  togglePlanMode,
}: MediaControlsProps) {
  const t = useT();

  return (
    <div className="absolute left-1.5 bottom-1.5 z-10 flex items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
            title={t.chat.attachment}
          >
            <Paperclip size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="min-w-36"
        >
          <DropdownMenuItem onSelect={onPickImage}>
            <Image size={14} />
            {t.chat.uploadImage}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPickFile}>
            <FileText size={14} />
            {t.chat.uploadFile}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={`w-7 h-7 transition-colors ${
          planModeEnabled
            ? "text-primary bg-primary/10 hover:bg-primary/15 hover:text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
        title={
          planModeEnabled
            ? t.chat.planMode.toggleOn
            : t.chat.planMode.toggleOff
        }
        aria-pressed={planModeEnabled}
        onClick={togglePlanMode}
      >
        <ClipboardList size={16} />
      </Button>
    </div>
  );
}
