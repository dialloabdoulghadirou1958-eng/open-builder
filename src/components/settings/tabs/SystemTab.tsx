import { useState } from "react";
import { Languages, Sun, Info, Trash2, Shield, Lock } from "lucide-react";
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
import { useSecretsStore } from "../../../store/secrets";
import { isTauri, setProxyEnabled } from "../../../lib/infra/proxy";
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

  const handleReset = async () => {
    useSettingsStore.getState().resetAll();
    useConversationStore.persist.clearStorage();
    useSnapshotStore.persist.clearStorage();
    useMemoryStore.persist.clearStorage();
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
        </div>
      )}

      <VaultPanel />

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
            "inline-flex flex-1 h-[calc(100%-1px)] items-center justify-center rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap transition-all",
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
