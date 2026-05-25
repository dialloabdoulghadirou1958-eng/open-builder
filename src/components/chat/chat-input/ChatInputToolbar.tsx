import {
  Check,
  CodeXml,
  FileText,
  Image,
  ListTodo,
  Loader2,
  Paperclip,
  SendHorizonal,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "../../../i18n";
import { SkillsMenu } from "./SkillsMenu";

interface ChatInputToolbarProps {
  onPickImage: () => void;
  onPickFile: () => void;
  onManageSkills?: () => void;
  skillsAvailable: boolean;
  planModeEnabled: boolean;
  setPlanMode: (enabled: boolean) => void;
  isGenerating: boolean;
  hasContent: boolean;
  isHoveringStop: boolean;
  onHoveringStopChange: (v: boolean) => void;
  onStop: () => void;
}

export function ChatInputToolbar({
  onPickImage,
  onPickFile,
  onManageSkills,
  skillsAvailable,
  planModeEnabled,
  setPlanMode,
  isGenerating,
  hasContent,
  isHoveringStop,
  onHoveringStopChange,
  onStop,
}: ChatInputToolbarProps) {
  const t = useT();

  return (
    <div className="flex items-center justify-between gap-1 px-1.5 py-1 border-t border-border/40">
      <div className="flex items-center gap-0.5">
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
          <DropdownMenuContent side="top" align="start" className="min-w-36">
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
        {skillsAvailable && onManageSkills && (
          <SkillsMenu onManage={onManageSkills} />
        )}
      </div>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              title={t.chat.planMode.modeMenuLabel}
            >
              {planModeEnabled ? <ListTodo size={14} /> : <CodeXml size={14} />}
              {planModeEnabled
                ? t.chat.planMode.planLabel
                : t.chat.planMode.autoLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-64">
            <DropdownMenuLabel>
              {t.chat.planMode.modeMenuLabel}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(
              [
                {
                  value: false,
                  icon: CodeXml,
                  label: t.chat.planMode.autoLabel,
                  description: t.chat.planMode.autoDescription,
                },
                {
                  value: true,
                  icon: ListTodo,
                  label: t.chat.planMode.planLabel,
                  description: t.chat.planMode.planDescription,
                },
              ] as const
            ).map((mode) => {
              const Icon = mode.icon;
              const selected = mode.value === planModeEnabled;
              return (
                <DropdownMenuItem
                  key={String(mode.value)}
                  onSelect={() => setPlanMode(mode.value)}
                  className="items-start gap-2.5 py-2"
                >
                  <Icon size={16} className="mt-0.5" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium leading-none">
                      {mode.label}
                    </span>
                    <span className="text-xs text-muted-foreground leading-snug">
                      {mode.description}
                    </span>
                  </div>
                  {selected && (
                    <Check size={14} className="mt-0.5 opacity-70" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {isGenerating ? (
          <Button
            type="button"
            size="icon"
            onClick={onStop}
            variant={isHoveringStop ? "destructive" : "secondary"}
            className="w-7 h-7 transition-all duration-200 rounded-full relative"
            title={t.chat.stopGeneration}
            onMouseEnter={() => onHoveringStopChange(true)}
            onMouseLeave={() => onHoveringStopChange(false)}
          >
            <span
              className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${isHoveringStop ? "opacity-0 scale-50" : "opacity-100 scale-100"}`}
            >
              <Loader2 size={16} className="animate-spin" />
            </span>
            <span
              className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${isHoveringStop ? "opacity-100 scale-100" : "opacity-0 scale-50"}`}
            >
              <Square size={14} fill="currentColor" />
            </span>
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!hasContent}
            className="w-7 h-7"
            title={t.chat.send}
          >
            <SendHorizonal size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
