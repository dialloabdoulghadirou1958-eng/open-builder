import { useMemo, useState } from "react";
import {
  Archive,
  Database,
  History,
  Info,
  Languages,
  Lock,
  ScrollText,
  Shield,
  Sun,
  Trash2,
} from "lucide-react";
import localforage from "localforage";
import {
  useSettingsStore,
} from "../../../store/settings";
import type {
  SystemSettings,
  Language,
  Theme,
} from "../../../store/settings";
import { useConversationStore } from "../../../store/conversation";
import { useSnapshotStore } from "../../../store/snapshot";
import { useMemoryStore } from "../../../store/memory";
import { useProjectTemplateStore } from "../../../store/project-templates";
import { useSecretsStore } from "../../../store/secrets";
import { useSecurityAuditStore } from "../../../store/security-audit";
import { useSkillsStore } from "../../../store/skills";
import { useStyleAssetStore } from "../../../store/style-assets";
import { useAuthStore } from "../../../store/auth";
import {
  analyzeStorage,
  formatBytes,
} from "../../../lib/utils/storage-governance";
import {
  clearProxyLog,
  getProxyLog,
  isTauri,
  parseProxyAllowedHosts,
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
import { StyleAssetsPanel } from "./StyleAssetsPanel";

interface SystemTabProps {
  form: SystemSettings;
  setForm: (v: SystemSettings) => void;
}

const STORAGE_SNAPSHOT_LIMIT = 20;

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
    useStyleAssetStore.persist.clearStorage();
    useSecurityAuditStore.persist.clearStorage();
    await localforage.clear();
    await useSecretsStore.getState().reset();

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
          <History size={16} className="inline mr-1" />
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

      <SecurityCenterPanel form={form} />

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

      <VaultPanel />

      <StyleAssetsPanel />

      <StorageGovernancePanel />

      <SkillScriptAuditPanel />

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

function SecurityCenterPanel({ form }: { form: SystemSettings }) {
  const t = useT();
  const isAuth = useAuthStore((s) => s.isLoggedIn());
  const vaultMode = useSecretsStore((s) => s.mode);
  const vaultUnlocked = useSecretsStore((s) => s.unlocked);
  const skills = useSkillsStore((s) => s.skills);
  const webSearch = useSettingsStore((s) => s.webSearch);
  const assetSearch = useSettingsStore((s) => s.assetSearch);
  const enabledSkillCount = Object.values(skills).filter((skill) => skill.enabled)
    .length;

  const allowedHosts = parseProxyAllowedHosts(form.reverseProxyAllowedHosts);

  const proxyStatus = !isTauri()
    ? t.settings.securityCenter.proxyBrowser
    : !form.reverseProxy
      ? t.settings.securityCenter.proxyOff
      : allowedHosts.length === 0
        ? t.settings.securityCenter.proxyOpen
        : t.settings.securityCenter.proxyLimited.replace(
            "{count}",
            String(allowedHosts.length),
          );

  const externalTools = [
    webSearch.engine !== "disabled" ? t.settings.tabs.search : null,
    assetSearch.engine !== "disabled" ? t.settings.tabs.asset : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="space-y-2">
      <Label>
        <Shield size={16} className="inline mr-1" />
        {t.settings.securityCenter.label}
      </Label>
      <div className="rounded-md border border-border bg-muted/30 p-2">
        <div className="grid grid-cols-2 gap-2">
          <SecurityStatusItem
            label={t.settings.securityCenter.auth}
            value={
              isAuth
                ? t.settings.securityCenter.signedIn
                : t.settings.securityCenter.localMode
            }
            tone={isAuth ? "ok" : "neutral"}
          />
          <SecurityStatusItem
            label={t.settings.securityCenter.vault}
            value={
              vaultMode === "passphrase" && !vaultUnlocked
                ? t.settings.securityCenter.vaultLocked
                : t.settings.securityCenter.vaultUnlocked
            }
            tone={vaultMode === "passphrase" && !vaultUnlocked ? "warn" : "ok"}
          />
          <SecurityStatusItem
            label={t.settings.securityCenter.proxy}
            value={proxyStatus}
            tone={
              isTauri() && form.reverseProxy && allowedHosts.length === 0
                ? "warn"
                : "neutral"
            }
          />
          <SecurityStatusItem
            label={t.settings.securityCenter.skills}
            value={t.settings.securityCenter.skillsEnabled.replace(
              "{count}",
              String(enabledSkillCount),
            )}
            tone={enabledSkillCount > 0 ? "warn" : "neutral"}
          />
          <div className="col-span-2">
            <SecurityStatusItem
              label={t.settings.securityCenter.externalTools}
              value={
                externalTools.length > 0
                  ? t.settings.securityCenter.externalEnabled.replace(
                      "{items}",
                      externalTools.join(" / "),
                    )
                  : t.settings.securityCenter.externalDisabled
              }
              tone={externalTools.length > 0 ? "ok" : "neutral"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityStatusItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  return (
    <div className="rounded border border-border/70 bg-background/60 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "ok" && "bg-green-500",
            tone === "warn" && "bg-amber-500",
            tone === "neutral" && "bg-muted-foreground/50",
          )}
        />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1 truncate text-[11px] text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function StorageGovernancePanel() {
  const t = useT();
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const snapshots = useSnapshotStore((s) => s.snapshots);
  const pruneSnapshots = useSnapshotStore((s) => s.pruneSnapshots);
  const memories = useMemoryStore((s) => s.memories);
  const skills = useSkillsStore((s) => s.skills);
  const templates = useProjectTemplateStore((s) => s.templates);
  const styleAssets = useStyleAssetStore((s) => s.assets);
  const auditEntries = useSecurityAuditStore((s) => s.skillScriptExecutions);
  const clearAudit = useSecurityAuditStore(
    (s) => s.clearSkillScriptExecutions,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const report = useMemo(
    () =>
      analyzeStorage({
        conversations,
        activeConversationId: activeId,
        snapshots,
        memories,
        skills,
        templates,
        styleAssets,
        skillScriptExecutions: auditEntries,
        maxSnapshotsPerConversation: STORAGE_SNAPSHOT_LIMIT,
      }),
    [
      activeId,
      auditEntries,
      conversations,
      memories,
      skills,
      snapshots,
      templates,
      styleAssets,
    ],
  );

  const showNotice = (count: number) => {
    setNotice(
      count > 0
        ? t.settings.storage.cleaned.replace("{count}", String(count))
        : t.settings.storage.nothingToClean,
    );
  };

  const cleanArchived = () => {
    const ids = report.cleanup.archivedConversationIds;
    if (ids.length === 0) {
      showNotice(0);
      return;
    }
    if (!window.confirm(t.settings.storage.confirmArchived)) return;
    ids.forEach(deleteConversation);
    showNotice(ids.length);
  };

  const cleanEmpty = () => {
    const ids = report.cleanup.emptyConversationIds;
    if (ids.length === 0) {
      showNotice(0);
      return;
    }
    if (!window.confirm(t.settings.storage.confirmEmpty)) return;
    ids.forEach(deleteConversation);
    showNotice(ids.length);
  };

  const pruneOldSnapshots = () => {
    if (report.cleanup.prunableSnapshotCount === 0) {
      showNotice(0);
      return;
    }
    if (!window.confirm(t.settings.storage.confirmSnapshots)) return;
    showNotice(pruneSnapshots(STORAGE_SNAPSHOT_LIMIT));
  };

  const clearAuditLog = () => {
    if (auditEntries.length === 0) {
      showNotice(0);
      return;
    }
    if (!window.confirm(t.settings.storage.confirmAudit)) return;
    const count = auditEntries.length;
    clearAudit();
    showNotice(count);
  };

  const statItems = [
    {
      label: t.settings.storage.conversations,
      value: report.conversations.count,
      detail: formatBytes(report.conversations.bytes),
    },
    {
      label: t.settings.storage.snapshots,
      value: report.snapshots.count,
      detail: formatBytes(report.snapshots.bytes),
    },
    {
      label: t.settings.storage.projectFiles,
      value: report.conversations.projectFileCount,
      detail: formatBytes(report.conversations.projectFilesBytes),
    },
    {
      label: t.settings.storage.templates,
      value: report.templates.count,
      detail: formatBytes(report.templates.bytes),
    },
    {
      label: t.settings.storage.styleAssets,
      value: report.styleAssets.count,
      detail: formatBytes(report.styleAssets.bytes),
    },
    {
      label: t.settings.storage.audit,
      value: report.securityAudit.count,
      detail: formatBytes(report.securityAudit.bytes),
    },
  ];

  return (
    <div className="space-y-2">
      <Label>
        <Database size={16} className="inline mr-1" />
        {t.settings.storage.label}
      </Label>
      <div className="rounded-md border border-border bg-muted/30 p-2 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t.settings.storage.total}
          </p>
          <span className="font-mono text-xs font-medium">
            {formatBytes(report.totalBytes)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {statItems.map((item) => (
            <div
              key={item.label}
              className="rounded border border-border/70 bg-background/60 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {item.label}
                </span>
                <span className="font-mono text-[11px]">{item.value}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-foreground">
                {item.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
          <span>
            {report.conversations.messagesCount} {t.settings.storage.messages}
          </span>
          <span>
            {report.memories.count} {t.settings.storage.memories}
          </span>
          <span>
            {report.skills.count} {t.settings.storage.skills}
          </span>
          <span>{formatBytes(report.conversations.compressedContextBytes)} {t.settings.storage.compressed}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-start px-2 text-xs"
            onClick={cleanArchived}
            disabled={report.cleanup.archivedConversationIds.length === 0}
          >
            <Archive size={13} className="mr-1.5" />
            {t.settings.storage.cleanupArchived}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-start px-2 text-xs"
            onClick={cleanEmpty}
            disabled={report.cleanup.emptyConversationIds.length === 0}
          >
            <Trash2 size={13} className="mr-1.5" />
            {t.settings.storage.cleanupEmpty}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-start px-2 text-xs"
            onClick={pruneOldSnapshots}
            disabled={report.cleanup.prunableSnapshotCount === 0}
          >
            <History size={13} className="mr-1.5" />
            {t.settings.storage.pruneSnapshots}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-start px-2 text-xs"
            onClick={clearAuditLog}
            disabled={auditEntries.length === 0}
          >
            <ScrollText size={13} className="mr-1.5" />
            {t.settings.storage.clearAudit}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t.settings.storage.keepSnapshots}
        </p>
        {notice && (
          <p className="rounded bg-background/80 px-2 py-1 text-[11px] text-foreground">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}

function SkillScriptAuditPanel() {
  const t = useT();
  const entries = useSecurityAuditStore((s) => s.skillScriptExecutions);
  const clear = useSecurityAuditStore((s) => s.clearSkillScriptExecutions);
  const recent = entries.slice(-5).reverse();

  return (
    <div className="space-y-2">
      <Label>
        <ScrollText size={16} className="inline mr-1" />
        {t.settings.skillAudit.label}
      </Label>
      <div className="rounded-md border border-border bg-muted/30 p-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {recent.length === 0
              ? t.settings.skillAudit.empty
              : `${recent.length} / ${entries.length}`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={clear}
            disabled={entries.length === 0}
          >
            {t.settings.skillAudit.clear}
          </Button>
        </div>
        {recent.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {recent.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]"
              >
                <span
                  className={
                    entry.status === "success"
                      ? "text-green-600"
                      : "text-destructive"
                  }
                >
                  {entry.status === "success"
                    ? t.settings.skillAudit.success
                    : t.settings.skillAudit.failed}
                </span>
                <span
                  className="truncate"
                  title={`${entry.skillName}: ${entry.scriptPath}`}
                >
                  {entry.skillName}: {entry.scriptPath}
                </span>
                <span className="font-mono text-muted-foreground">
                  {entry.exitCode ?? "-"}
                </span>
                <span className="text-muted-foreground truncate">
                  {new Date(entry.finishedAt).toLocaleTimeString()}
                  {entry.args.length > 0
                    ? ` · ${t.settings.skillAudit.args}: ${entry.args.join(" ")}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VaultPanel() {
  const t = useT();
  const mode = useSecretsStore((s) => s.mode);
  const unlocked = useSecretsStore((s) => s.unlocked);
  const lock = useSecretsStore((s) => s.lock);
  const upgradeToPassphrase = useSecretsStore((s) => s.upgradeToPassphrase);
  const downgradeToDevice = useSecretsStore((s) => s.downgradeToDevice);

  const [showEnable, setShowEnable] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleEnable = async () => {
    if (p1.length < 8) {
      setError(t.settings.vault.tooShort);
      return;
    }
    if (p1 !== p2) {
      setError(t.settings.vault.mismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await upgradeToPassphrase(p1);
      setShowEnable(false);
      setP1("");
      setP2("");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await downgradeToDevice();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>
        <Lock size={16} className="inline mr-1" />
        {t.settings.vault.label}
      </Label>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
        <p>
          <span className="text-muted-foreground">
            {mode === "passphrase"
              ? t.settings.vault.modePassphrase
              : t.settings.vault.modeDevice}
          </span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span
            className={
              unlocked ? "text-foreground" : "text-destructive"
            }
          >
            {unlocked
              ? t.settings.vault.statusUnlocked
              : t.settings.vault.statusLocked}
          </span>
        </p>
        <p className="text-muted-foreground">
          {mode === "passphrase"
            ? t.settings.vault.hintPassphrase
            : t.settings.vault.hintDevice}
        </p>
      </div>

      {mode === "device" && !showEnable && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowEnable(true)}
          disabled={!unlocked}
        >
          {t.settings.vault.enablePassphrase}
        </Button>
      )}

      {mode === "device" && showEnable && (
        <div className="space-y-2">
          <Input
            type="password"
            placeholder={t.settings.vault.newPassphrase}
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            disabled={busy}
          />
          <Input
            type="password"
            placeholder={t.settings.vault.confirmPassphrase}
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            disabled={busy}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowEnable(false);
                setError(null);
                setP1("");
                setP2("");
              }}
              disabled={busy}
            >
              {t.settings.vault.cancel}
            </Button>
            <Button className="flex-1" onClick={handleEnable} disabled={busy}>
              {t.settings.vault.confirm}
            </Button>
          </div>
        </div>
      )}

      {mode === "passphrase" && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => lock()}
            disabled={!unlocked}
          >
            {t.settings.vault.lock}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDisable}
            disabled={!unlocked || busy}
          >
            {t.settings.vault.disablePassphrase}
          </Button>
        </div>
      )}
    </div>
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
