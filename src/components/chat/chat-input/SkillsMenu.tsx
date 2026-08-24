import { useMemo } from "react";
import { Plus, ScrollText } from "lucide-react";
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
  onManage: () => void;
}

export function SkillsMenu({ onManage }: SkillsMenuProps) {
  const t = useT();
  const skills = useSkillsStore((s) => s.skills);
  const setSkillEnabled = useSkillsStore((s) => s.setSkillEnabled);

  const sortedSkills = useMemo(
    () =>
      Object.values(skills).sort((a, b) => {
        if (a.source !== b.source) return a.source === "builtin" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [skills],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="w-7 h-7 text-muted-foreground hover:text-foreground"
          title={t.chat.skills}
        >
          <ScrollText size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="min-w-56 max-h-72 overflow-y-auto"
      >
        <DropdownMenuLabel>{t.chat.skills}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sortedSkills.length === 0 ? (
          <DropdownMenuItem disabled>{t.skills.empty}</DropdownMenuItem>
        ) : (
          sortedSkills.map((skill) => (
            <DropdownMenuCheckboxItem
              key={skill.id}
              checked={skill.enabled}
              onCheckedChange={(checked) =>
                setSkillEnabled(skill.id, Boolean(checked))
              }
              onSelect={(e) => e.preventDefault()}
            >
              {skill.name}
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
