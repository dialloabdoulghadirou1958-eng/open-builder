import { useState } from "react";
import { ScanSearch, ShieldCheck } from "lucide-react";
import type { SystemSettings } from "../../../store/settings";
import {
  clearPermissionActivity,
  getPermissionActivity,
} from "../../../lib/security/activity-log";
import { Button } from "@/components/ui/button";
import { CapsuleGroup } from "@/components/ui/capsule-group";
import { Label } from "@/components/ui/label";
import { useT } from "../../../i18n";

interface AdvancedTabProps {
  form: SystemSettings;
  setForm: (value: SystemSettings) => void;
}

export function AdvancedTab({ form, setForm }: AdvancedTabProps) {
  const t = useT();
  const [permissionLog, setPermissionLog] = useState(() =>
    getPermissionActivity(),
  );

  return (
    <>
      <div className="space-y-2">
        <Label>
          <ScanSearch size={16} className="inline mr-1" />
          {t.settings.autoQa.label}
        </Label>
        <CapsuleGroup
          label={t.settings.autoQa.label}
          value={form.autoQaEnabled ? "on" : "off"}
          onChange={(value) =>
            setForm({ ...form, autoQaEnabled: value === "on" })
          }
          options={[
            { value: "on", label: t.settings.autoQa.on },
            { value: "off", label: t.settings.autoQa.off },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t.settings.autoQa.hint}
        </p>
      </div>

      <div className="space-y-2">
        <Label>
          <ShieldCheck size={16} className="inline mr-1" />
          {t.settings.permissionActivity.label}
        </Label>
        <div className="rounded-md border border-border bg-muted/30 p-2 space-y-2">
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPermissionLog(getPermissionActivity())}
            >
              {t.settings.permissionActivity.refresh}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                clearPermissionActivity();
                setPermissionLog([]);
              }}
            >
              {t.settings.permissionActivity.clear}
            </Button>
          </div>
          {permissionLog.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t.settings.permissionActivity.empty}
            </p>
          ) : (
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {permissionLog
                .slice(-8)
                .reverse()
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[auto_auto_1fr] gap-1 text-[11px]"
                  >
                    <span className="font-mono">{entry.mode}</span>
                    <span
                      className={
                        entry.decision === "denied"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {entry.decision}
                    </span>
                    <span className="truncate">
                      {entry.source} · {entry.tool}
                      {entry.target ? ` · ${entry.target}` : ""}
                    </span>
                  </div>
                ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t.settings.permissionActivity.hint}
          </p>
        </div>
      </div>
    </>
  );
}
