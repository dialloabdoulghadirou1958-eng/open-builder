import { useMemo } from "react";
import { Loader2, Plus, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSkillsStore } from "../../../store/skills";
import { useT } from "../../../i18n";

interface SkillsMenuProps {
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onManage: () => void;
  initializing?: boolean;
}

export function SkillsMenu({
  selectedIds,
  onSelectedIdsChange,
  onManage,
  initializing = false,
}: SkillsMenuProps) {
  const t = useT();
  const skills = useSkillsStore((state) => state.skills);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const sortedSkills = useMemo(
    () =>
      Object.values(skills).sort((a, b) => {
        if (a.source !== b.source) return a.source === "builtin" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [skills],
  );

  const toggleSkill = (id: string, checked: boolean) => {
    if (checked) {
      onSelectedIdsChange(Array.from(new Set([...selectedIds, id])));
    } else {
      onSelectedIdsChange(selectedIds.filter((skillId) => skillId !== id));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 min-w-7 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
          title={t.skills.forceForNext}
          aria-label={t.skills.forceForNext}
        >
          {initializing ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <ScrollText size={16} aria-hidden="true" />
          )}
          {selectedIds.length > 0 && (
            <span className="min-w-4 text-center text-[10px] font-medium tabular-nums">
              {selectedIds.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="min-w-64 max-h-72 overflow-y-auto"
      >
        <DropdownMenuLabel>{t.skills.forceForNext}</DropdownMenuLabel>
        <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
          {t.skills.forceForNextHint}
        </p>
        <DropdownMenuSeparator />
        {sortedSkills.length === 0 ? (
          <DropdownMenuItem disabled>
            {initializing ? t.app.loading : t.skills.empty}
          </DropdownMenuItem>
        ) : (
          sortedSkills.map((skill) => (
            <DropdownMenuCheckboxItem
              key={skill.id}
              checked={selected.has(skill.id)}
              onCheckedChange={(checked) =>
                toggleSkill(skill.id, Boolean(checked))
              }
              onSelect={(event) => event.preventDefault()}
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="truncate">{skill.name}</span>
                {!skill.autoEnabled && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t.skills.autoMatchOff}
                  </span>
                )}
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}>
          <Plus size={14} />
          {t.skills.manage}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
