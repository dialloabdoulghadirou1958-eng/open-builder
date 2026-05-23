import { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu,
  Search,
  RefreshCw,
  LogOut,
  Image as ImageIcon,
} from "lucide-react";
import { useAuthStore } from "../../../store/auth";
import { useSettingsStore } from "../../../store/settings";
import type {
  ServerServiceSettings,
  ServerServiceCache,
} from "../../../store/settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "../../../i18n";
import {
  fetchServerModels,
  fetchSearchProviders,
  fetchAssetProviders,
} from "../../../lib/services/mohua-api";
import type {
  ServerModel,
  SearchProvider,
  AssetProvider,
} from "../../../types/api";

interface ProviderSelectOption {
  id: string;
  label: string;
}

function ProviderSelectRow({
  id,
  icon,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  defaultOptionLabel,
  onRefresh,
  refreshing,
  hint,
}: {
  id?: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: ProviderSelectOption[];
  placeholder: string;
  defaultOptionLabel?: string;
  onRefresh: () => void;
  refreshing: boolean;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {icon}
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {defaultOptionLabel && (
              <SelectItem value="default">{defaultOptionLabel}</SelectItem>
            )}
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 size-9"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("Session expired") ||
    err.message.includes("401") ||
    err.message.includes("Unauthorized")
  );
}

interface ServerServiceTabProps {
  form: ServerServiceSettings;
  setForm: React.Dispatch<React.SetStateAction<ServerServiceSettings>>;
}

export function ServerServiceTab({ form, setForm }: ServerServiceTabProps) {
  const t = useT();
  const profile = useAuthStore((s) => s.user);
  const serverServiceCache = useSettingsStore((s) => s.serverServiceCache);
  const patchServerServiceCache = useSettingsStore(
    (s) => s.patchServerServiceCache,
  );

  const models: ServerModel[] = serverServiceCache?.models ?? [];
  const searchProviders: SearchProvider[] =
    serverServiceCache?.searchProviders ?? [];
  const assetProviders: AssetProvider[] =
    serverServiceCache?.assetProviders ?? [];

  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isRefreshingSearch, setIsRefreshingSearch] = useState(false);
  const [isRefreshingAsset, setIsRefreshingAsset] = useState(false);
  const fetchingRef = useRef(false);

  const loadData = useCallback(
    async (force = false) => {
      if (fetchingRef.current) return;

      const cache = useSettingsStore.getState().serverServiceCache;
      if (!force && cache) {
        return;
      }

      fetchingRef.current = true;
      setIsRefreshingModels(true);
      setIsRefreshingSearch(true);
      setIsRefreshingAsset(true);
      try {
        const handleError =
          <T extends unknown[]>(fallback: T) =>
          (err: unknown): T => {
            if (isAuthError(err)) return [] as unknown as T;
            console.error(err);
            return fallback;
          };

        const [_models, _search, _assets] = await Promise.all([
          fetchServerModels().catch(handleError(cache?.models ?? [])),
          fetchSearchProviders().catch(
            handleError(cache?.searchProviders ?? []),
          ),
          fetchAssetProviders().catch(handleError(cache?.assetProviders ?? [])),
        ]);

        patchServerServiceCache({
          models: _models,
          searchProviders: _search,
          assetProviders: _assets,
        });

        setForm((prev) => {
          if (prev.selectedModel || _models.length === 0) return prev;
          return { ...prev, selectedModel: _models[0].id };
        });
      } catch (e) {
        console.error(e);
      } finally {
        fetchingRef.current = false;
        setTimeout(() => {
          setIsRefreshingModels(false);
          setIsRefreshingSearch(false);
          setIsRefreshingAsset(false);
        }, 600);
      }
    },
    [setForm, patchServerServiceCache],
  );

  const refreshProvider = async <T extends unknown[]>(
    fetchFn: () => Promise<T>,
    setRefresher: (val: boolean) => void,
    cacheKey: keyof ServerServiceCache,
  ) => {
    setRefresher(true);
    try {
      const data = await fetchFn();
      patchServerServiceCache({
        [cacheKey]: data,
      } as Partial<ServerServiceCache>);
    } catch (err) {
      if (isAuthError(err)) {
        patchServerServiceCache({
          [cacheKey]: [],
        } as Partial<ServerServiceCache>);
      } else {
        console.error(err);
      }
    } finally {
      setTimeout(() => setRefresher(false), 600);
    }
  };

  const refreshModels = () =>
    refreshProvider(fetchServerModels, setIsRefreshingModels, "models");
  const refreshSearch = () =>
    refreshProvider(
      fetchSearchProviders,
      setIsRefreshingSearch,
      "searchProviders",
    );
  const refreshAsset = () =>
    refreshProvider(
      fetchAssetProviders,
      setIsRefreshingAsset,
      "assetProviders",
    );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  return (
    <>
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        {profile?.picture ? (
          <img
            src={profile.picture}
            alt="Avatar"
            className="h-10 w-10 rounded-full object-cover shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-10 w-10 text-xl font-semibold bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0">
            {profile?.name?.charAt(0) || "U"}
          </div>
        )}
        <div className="flex-1">
          <div className="text-sm font-medium">
            {t.settings.serverService.loggedInAs} {profile?.name || "User"}
          </div>
          <div className="text-xs text-muted-foreground">{profile?.email}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 size-9 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50"
          onClick={(e) => {
            e.preventDefault();
            useAuthStore.getState().clearAuth();
          }}
        >
          <LogOut size={16} />
        </Button>
      </div>

      <div className="pt-2">
        <ProviderSelectRow
          id="selectedModel"
          icon={<Cpu size={16} className="inline mr-1" />}
          label={t.settings.serverService.modelLabel}
          value={form.selectedModel || ""}
          onValueChange={(v) => setForm({ ...form, selectedModel: v })}
          options={models.map((m) => ({ id: m.id, label: m.displayName }))}
          placeholder={t.settings.serverService.selectPlaceholder}
          onRefresh={refreshModels}
          refreshing={isRefreshingModels}
          hint={t.settings.serverService.modelDesc}
        />
      </div>

      <div className="space-y-4 pt-4 border-t">
        <ProviderSelectRow
          id="webSearchProviderId"
          icon={<Search size={16} className="inline mr-1" />}
          label={t.settings.serverService.webSearch}
          value={form.webSearchProviderId || "default"}
          onValueChange={(v) =>
            setForm({
              ...form,
              webSearchProviderId: v === "default" ? "" : v,
            })
          }
          options={searchProviders.map((p) => ({ id: p.id, label: p.name }))}
          placeholder={
            t.settings.serverService.providerDefault || "Default (Auto)"
          }
          defaultOptionLabel={
            t.settings.serverService.providerDefault || "Default (Auto)"
          }
          onRefresh={refreshSearch}
          refreshing={isRefreshingSearch}
          hint={t.settings.serverService.webSearchDesc}
        />
      </div>

      <div className="space-y-4 pt-4 border-t">
        <ProviderSelectRow
          id="assetSearchProviderId"
          icon={<ImageIcon size={16} className="inline mr-1" />}
          label={t.settings.serverService.assetSearch}
          value={form.assetSearchProviderId || "default"}
          onValueChange={(v) =>
            setForm({
              ...form,
              assetSearchProviderId: v === "default" ? "" : v,
            })
          }
          options={assetProviders.map((p) => ({ id: p.id, label: p.name }))}
          placeholder={
            t.settings.serverService.providerDefault || "Default (Auto)"
          }
          defaultOptionLabel={
            t.settings.serverService.providerDefault || "Default (Auto)"
          }
          onRefresh={refreshAsset}
          refreshing={isRefreshingAsset}
          hint={t.settings.serverService.assetSearchDesc}
        />
      </div>
    </>
  );
}
