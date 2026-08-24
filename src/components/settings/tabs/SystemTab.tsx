import { useState } from "react";
import {
  Info,
  Languages,
  ScanSearch,
  Shield,
  Sun,
  Trash2,
} from "lucide-react";
import localforage from "localforage";
import { useSettingsStore } from "../../../store/settings";
import type {
  SystemSettings,
  Language,
  Theme,
} from "../../../store/settings";
import { useConversationStore } from "../../../store/conversation";
import { useSnapshotStore } from "../../../store/snapshot";
import { useMemoryStore } from "../../../store/memory";
import { useProjectTemplateStore } from "../../../store/project-templates";
import {
  clearProxyLog,
  getProxyLog,
  isTauri,
  setProxyAllowedHosts,
  setProxyEnabled,
  type ProxyLogEntry,
} from "../../../lib/infra/proxy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { version } from "../../../../package.json";
import { useT } from "../../../i18n";

interface SystemTabProps {
  form: SystemSettings;
  setForm: (v: SystemSettings) => void;
}

export function SystemTab({ form, setForm }: SystemTabProps) {
  const t = useT();
  const [showConfirm, setShowConfirm] = useState(false);
  const [proxyLog, setProxyLog] = useState<ProxyLogEntry[]>(() =>
    getProxyLog(),
  );

  const handleReset = async () => {
    useSettingsStore.getState().resetAll();
    useConversationStore.persist.clearStorage();
    useSnapshotStore.persist.clearStorage();
    useMemoryStore.persist.clearStorage();
    useProjectTemplateStore.persist.clearStorage();
    await localforage.clear();

    window.location.reload();
  };

  return (
    <>
      <div className="space-y-2">
        <Label>
          <Languages size={16} className="inline mr-1" />
          {t.settings.language.label}
        </Label>
        <CapsuleGroup
          value={form.language}
          onChange={(v) => setForm({ ...form, language: v as Language })}
          options={[
            { value: "system", label: t.settings.language.system },
            { value: "zh", label: t.settings.language.zh },
            { value: "en", label: t.settings.language.en },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t.settings.language.hint}
        </p>
      </div>

      <div className="space-y-2">
        <Label>
          <Sun size={16} className="inline mr-1" />
          {t.settings.theme.label}
        </Label>
        <CapsuleGroup
          value={form.theme}
          onChange={(v) => setForm({ ...form, theme: v as Theme })}
          options={[
            { value: "system", label: t.settings.theme.system },
            { value: "light", label: t.settings.theme.light },
            { value: "dark", label: t.settings.theme.dark },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t.settings.theme.hint}</p>
      </div>

      <div className="space-y-2">
        <Label>
          <ScanSearch size={16} className="inline mr-1" />
          {t.settings.autoQa.label}
        </Label>
        <CapsuleGroup
          value={form.autoQaEnabled ? "on" : "off"}
          onChange={(v) =>
            setForm({ ...form, autoQaEnabled: v === "on" })
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

      {isTauri() && (
        <div className="space-y-2">
          <Label>
            <Shield size={16} className="inline mr-1" />
            {t.settings.reverseProxy.label}
          </Label>
          <CapsuleGroup
            value={form.reverseProxy ? "on" : "off"}
            onChange={(v) => {
              const enabled = v === "on";
              setForm({ ...form, reverseProxy: enabled });
              setProxyEnabled(enabled);
            }}
            options={[
              { value: "on", label: t.settings.reverseProxy.on },
              { value: "off", label: t.settings.reverseProxy.off },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {t.settings.reverseProxy.hint}
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t.settings.reverseProxy.allowedHosts}
            </Label>
            <Input
              value={form.reverseProxyAllowedHosts}
              onChange={(e) => {
                const value = e.target.value;
                setForm({ ...form, reverseProxyAllowedHosts: value });
                setProxyAllowedHosts(value);
              }}
              placeholder="api.openai.com, *.anthropic.com"
              className="h-8 text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.reverseProxy.allowedHostsHint}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                {t.settings.reverseProxy.recentRequests}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setProxyLog(getProxyLog())}
                >
                  {t.settings.reverseProxy.refreshLog}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    clearProxyLog();
                    setProxyLog([]);
                  }}
                >
                  {t.settings.reverseProxy.clearLog}
                </Button>
              </div>
            </div>
            {proxyLog.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t.settings.reverseProxy.emptyLog}
              </p>
            ) : (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {proxyLog.slice(-5).reverse().map((entry) => (
                  <div
                    key={`${entry.timestamp}-${entry.kind}-${entry.host}-${entry.path}`}
                    className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]"
                  >
                    <span className="font-mono text-muted-foreground">
                      {entry.method}
                    </span>
                    <span className="truncate" title={`${entry.host}${entry.path}`}>
                      {entry.host}
                      {entry.path}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {entry.kind}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>
          <Trash2 size={16} className="inline mr-1" />
          {t.settings.reset.label}
        </Label>
        {!showConfirm ? (
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => setShowConfirm(true)}
          >
            {t.settings.reset.button}
          </Button>
        ) : (
          <>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowConfirm(false)}
              >
                {t.settings.reset.cancel}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleReset}
              >
                {t.settings.reset.confirm}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.settings.reset.warning}
            </p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          <Info size={16} className="inline mr-1" />
          {t.settings.version.label}
        </Label>
        <p className="text-md text-foreground text-center">
          v{version}
          <a
            href="https://github.com/Amery2010/open-builder/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-xs text-primary hover:underline"
          >
            {t.settings.version.checkUpdate}
          </a>
        </p>
      </div>
    </>
  );
}
function CapsuleGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex w-full items-center rounded-lg bg-muted p-0.75 h-9">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "inline-flex flex-1 h-[calc(100%-1px)] items-center justify-center rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,transform]",
            value === opt.value
              ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
              : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
