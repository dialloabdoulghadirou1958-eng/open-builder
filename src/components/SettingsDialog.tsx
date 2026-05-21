import { useState, useEffect, useCallback, useRef } from "react";
import {
  Key,
  Globe,
  Cpu,
  Search,
  Languages,
  Sun,
  Info,
  RefreshCw,
  Trash2,
  Shield,
  LogOut,
  Image as ImageIcon,
} from "lucide-react";
import {
  AISettings,
  WebSearchSettings,
  AssetSearchSettings,
  SystemSettings,
  ServerServiceSettings,
  Language,
  Theme,
  ServerServiceCache,
  useSettingsStore,
} from "../store/settings";
import { useAuthStore } from "../store/auth";
import { useConversationStore } from "../store/conversation";
import { useSnapshotStore } from "../store/snapshot";
import { useMemoryStore } from "../store/memory";
import localforage from "localforage";
import { isTauri, setProxyEnabled } from "../lib/proxy";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  fetchModelList,
  DEFAULT_BASE_URLS,
  resolveBaseURL,
} from "@/lib/ai-provider";
import type { ApiType } from "@/lib/ai-provider";
import { version } from "../../package.json";
import { useT } from "../i18n";
import {
  fetchServerModels,
  fetchSearchProviders,
  fetchAssetProviders,
  ServerModel,
  SearchProvider,
  AssetProvider,
} from "../lib/mohua-api";

const API_ENDPOINTS: Record<ApiType, string> = {
  "openai-compatible": "/chat/completions",
  openai: "/responses",
  anthropic: "/messages",
  google: "/models",
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  webSearchSettings: WebSearchSettings;
  onSaveWebSearch: (settings: WebSearchSettings) => void;
  assetSearchSettings: AssetSearchSettings;
  onSaveAssetSearch: (settings: AssetSearchSettings) => void;
  systemSettings: SystemSettings;
  onSaveSystem: (settings: SystemSettings) => void;
  serverServiceSettings: ServerServiceSettings;
  onSaveServerService: (settings: Partial<ServerServiceSettings>) => void;
}

export function SettingsDialog({
  isOpen,
  onClose,
  settings,
  onSave,
  webSearchSettings,
  onSaveWebSearch,
  assetSearchSettings,
  onSaveAssetSearch,
  systemSettings,
  onSaveSystem,
  serverServiceSettings,
  onSaveServerService,
}: SettingsDialogProps) {
  const t = useT();
  const isAuth = useAuthStore((s) => s.isLoggedIn());

  const [formData, setFormData] = useState<AISettings>(settings);
  const [webSearchForm, setWebSearchForm] =
    useState<WebSearchSettings>(webSearchSettings);
  const [assetSearchForm, setAssetSearchForm] =
    useState<AssetSearchSettings>(assetSearchSettings);
  const [systemForm, setSystemForm] = useState<SystemSettings>(systemSettings);
  const [serverServiceForm, setServerServiceForm] =
    useState<ServerServiceSettings>(serverServiceSettings);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    setWebSearchForm(webSearchSettings);
  }, [webSearchSettings]);

  useEffect(() => {
    setAssetSearchForm(assetSearchSettings);
  }, [assetSearchSettings]);

  useEffect(() => {
    setSystemForm(systemSettings);
  }, [systemSettings]);

  useEffect(() => {
    setServerServiceForm(serverServiceSettings);
  }, [serverServiceSettings]);

  const handleSave = () => {
    onSave(formData);
    onSaveWebSearch(webSearchForm);
    onSaveAssetSearch(assetSearchForm);
    onSaveSystem(systemForm);
    if (isAuth) {
      onSaveServerService(serverServiceForm);
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md sm:max-w-md max-h-[90dvh] flex flex-col">
        <DialogHeader className="px-2">
          <DialogTitle>{t.settings.title}</DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue={isAuth ? "serverService" : "model"}
          className="flex-1 min-h-0 flex flex-col px-2"
        >
          <TabsList className="w-full">
            {isAuth ? (
              <TabsTrigger value="serverService">
                {t.settings.tabs.serverService}
              </TabsTrigger>
            ) : (
              <>
                <TabsTrigger value="model">{t.settings.tabs.model}</TabsTrigger>
                <TabsTrigger value="search">
                  {t.settings.tabs.search}
                </TabsTrigger>
                <TabsTrigger value="asset">{t.settings.tabs.asset}</TabsTrigger>
              </>
            )}
            <TabsTrigger value="system">{t.settings.tabs.system}</TabsTrigger>
          </TabsList>

          {isAuth ? (
            <TabsContent value="serverService" className="py-4 space-y-4">
              <ServerServiceTab
                form={serverServiceForm}
                setForm={setServerServiceForm}
              />
            </TabsContent>
          ) : (
            <>
              {/* ── 模型设置 ── */}
              <TabsContent value="model" className="py-4 space-y-4">
                <ModelSettingsTab
                  formData={formData}
                  setFormData={setFormData}
                />
              </TabsContent>

              {/* ── 联网搜索 ── */}
              <TabsContent value="search" className="py-4 space-y-4">
                <WebSearchTab
                  form={webSearchForm}
                  setForm={setWebSearchForm}
                  apiType={formData.apiType}
                />
              </TabsContent>

              {/* ── 素材搜索 ── */}
              <TabsContent value="asset" className="py-4 space-y-4">
                <AssetSearchTab
                  form={assetSearchForm}
                  setForm={setAssetSearchForm}
                />
              </TabsContent>
            </>
          )}

          {/* ── 系统设置 ── */}
          <TabsContent value="system" className="py-4 space-y-4">
            <SystemTab form={systemForm} setForm={setSystemForm} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={onClose}>
            {t.settings.cancel}
          </Button>
          <Button onClick={handleSave}>{t.settings.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Model Settings Tab ── */

function ModelSettingsTab({
  formData,
  setFormData,
}: {
  formData: AISettings;
  setFormData: (v: AISettings) => void;
}) {
  const t = useT();
  const modelCache = useSettingsStore((s) => s.modelCache);
  const setModelCache = useSettingsStore((s) => s.setModelCache);
  const clearModelCache = useSettingsStore((s) => s.clearModelCache);

  const cacheHit =
    modelCache &&
    modelCache.apiType === formData.apiType &&
    modelCache.apiBaseUrl === formData.apiBaseUrl &&
    modelCache.apiKey === formData.apiKey;

  const [models, setModels] = useState<string[]>(
    cacheHit ? modelCache.models : [],
  );
  const [fetchFailed, setFetchFailed] = useState(!cacheHit);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadingKeyRef = useRef<string>("");

  const fetchModels = useCallback(async () => {
    if (!formData.apiBaseUrl || !formData.apiKey) {
      setModels([]);
      setFetchFailed(true);
      clearModelCache();
      return;
    }
    const currentKey = `${formData.apiType}-${formData.apiBaseUrl}-${formData.apiKey}`;
    if (loadingKeyRef.current === currentKey) return;

    setIsLoading(true);
    setIsRefreshing(true);
    loadingKeyRef.current = currentKey;
    try {
      const ids = await fetchModelList(
        formData.apiType,
        formData.apiBaseUrl,
        formData.apiKey,
      );
      setModels(ids);
      setFetchFailed(false);
      setModelCache({
        models: ids,
        apiType: formData.apiType,
        apiBaseUrl: formData.apiBaseUrl,
        apiKey: formData.apiKey,
      });
    } catch {
      setModels([]);
      setFetchFailed(true);
      clearModelCache();
    } finally {
      loadingKeyRef.current = "";
      setIsLoading(false);
      setTimeout(() => setIsRefreshing(false), 600);
    }
  }, [
    formData.apiType,
    formData.apiBaseUrl,
    formData.apiKey,
    setModelCache,
    clearModelCache,
  ]);

  useEffect(() => {
    if (!formData.apiBaseUrl || !formData.apiKey) {
      setModels([]);
      setFetchFailed(true);
      return;
    }
    // Use cache if settings haven't changed
    const cached = useSettingsStore.getState().modelCache;
    if (
      cached &&
      cached.apiType === formData.apiType &&
      cached.apiBaseUrl === formData.apiBaseUrl &&
      cached.apiKey === formData.apiKey
    ) {
      setModels(cached.models);
      setFetchFailed(false);
      return;
    }
    const timer = setTimeout(() => {
      fetchModels();
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.apiType, formData.apiBaseUrl, formData.apiKey]);

  const handleApiTypeChange = (v: string) => {
    const apiType = v as ApiType;
    setFormData({
      ...formData,
      apiType,
      apiBaseUrl: DEFAULT_BASE_URLS[apiType],
      model: "",
    });
    setModels([]);
    setFetchFailed(true);
    clearModelCache();
  };

  const showDropdown = models.length > 0 && !fetchFailed;
  const displayModels =
    showDropdown && formData.model && !models.includes(formData.model)
      ? [formData.model, ...models]
      : models;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="apiType">
          <Cpu size={16} className="inline mr-1" />
          {t.settings.apiType?.label ?? "API Type"}
        </Label>
        <Select value={formData.apiType} onValueChange={handleApiTypeChange}>
          <SelectTrigger id="apiType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai-compatible">
              OpenAI Compatible{" "}
              <span className="text-blue-500">/v1/chat/completions</span>
            </SelectItem>
            <SelectItem value="openai">
              OpenAI <span className="text-indigo-500">/v1/responses</span>
            </SelectItem>
            <SelectItem value="anthropic">
              Anthropic <span className="text-amber-500">/v1/messages</span>
            </SelectItem>
            <SelectItem value="google">
              Google <span className="text-rose-500">/v1beta/models</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t.settings.apiType?.hint ?? "Select the API provider type"}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">
          <Key size={16} className="inline mr-1" />
          API Key
        </Label>
        <Input
          id="apiKey"
          type="password"
          value={formData.apiKey}
          onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
          placeholder="sk-..."
        />
        <p className="text-xs text-muted-foreground">
          {t.settings.apiKey.hint}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiBaseUrl">
          <Globe size={16} className="inline mr-1" />
          API Base URL
        </Label>
        <Input
          id="apiBaseUrl"
          type="text"
          value={formData.apiBaseUrl}
          onChange={(e) =>
            setFormData({ ...formData, apiBaseUrl: e.target.value })
          }
          placeholder={DEFAULT_BASE_URLS[formData.apiType]}
        />
        <p className="text-xs text-muted-foreground break-all">
          {t.settings.apiBaseUrl.preview}:{" "}
          {resolveBaseURL(
            formData.apiBaseUrl || DEFAULT_BASE_URLS[formData.apiType],
            formData.apiType,
          ) + API_ENDPOINTS[formData.apiType]}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">
          <Cpu size={16} className="inline mr-1" />
          {t.settings.model.label}
        </Label>
        {showDropdown ? (
          <div className="flex gap-2">
            <Select
              value={formData.model}
              onValueChange={(v) => setFormData({ ...formData, model: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.settings.model.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {displayModels.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 size-9"
              onClick={(e) => {
                e.preventDefault();
                fetchModels();
              }}
              disabled={isLoading}
            >
              <RefreshCw
                size={14}
                className={cn(isRefreshing && "animate-spin")}
              />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              id="model"
              type="text"
              value={formData.model}
              onChange={(e) =>
                setFormData({ ...formData, model: e.target.value })
              }
              placeholder={t.settings.model.hint}
              className="flex-1"
            />
            {formData.apiBaseUrl && formData.apiKey && (
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 size-9"
                onClick={(e) => {
                  e.preventDefault();
                  fetchModels();
                }}
                disabled={isLoading}
              >
                <RefreshCw
                  size={14}
                  className={cn(isRefreshing && "animate-spin")}
                />
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t.settings.model.hint}</p>
      </div>
    </>
  );
}

/* ── Web Search Tab ── */

function WebSearchTab({
  form,
  setForm,
  apiType,
}: {
  form: WebSearchSettings;
  setForm: (v: WebSearchSettings) => void;
  apiType: string;
}) {
  const t = useT();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="searchEngine">
          <Search size={16} className="inline mr-1" />
          {t.settings.webSearch.engine}
        </Label>
        <Select
          value={form.engine}
          onValueChange={(v) => setForm({ ...form, engine: v as any })}
        >
          <SelectTrigger id="searchEngine" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disabled">
              {t.settings.webSearch.disabled}
            </SelectItem>
            {apiType !== "openai-compatible" && (
              <SelectItem value="builtin">
                {t.settings.webSearch.builtin}
              </SelectItem>
            )}
            <SelectItem value="tavily">Tavily</SelectItem>
            <SelectItem value="firecrawl">Firecrawl</SelectItem>
          </SelectContent>
        </Select>

        {form.engine === "builtin" ? (
          <p className="text-xs text-muted-foreground">
            {t.settings.webSearch.builtinDesc}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t.settings.webSearch.desc}
          </p>
        )}
      </div>

      {form.engine === "tavily" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="tavilyApiKey">
              <Key size={16} className="inline mr-1" />
              Tavily API Key
            </Label>
            <Input
              id="tavilyApiKey"
              type="password"
              value={form.tavilyApiKey}
              onChange={(e) =>
                setForm({ ...form, tavilyApiKey: e.target.value })
              }
              placeholder="tvly-..."
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.tavilyKey.hint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tavilyApiUrl">
              <Globe size={16} className="inline mr-1" />
              Tavily API URL
            </Label>
            <Input
              id="tavilyApiUrl"
              type="text"
              value={form.tavilyApiUrl}
              onChange={(e) =>
                setForm({ ...form, tavilyApiUrl: e.target.value })
              }
              placeholder="https://api.tavily.com"
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.tavilyUrl.hint}
            </p>
          </div>
        </>
      )}

      {form.engine === "firecrawl" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="firecrawlApiKey">
              <Key size={16} className="inline mr-1" />
              Firecrawl API Key
            </Label>
            <Input
              id="firecrawlApiKey"
              type="password"
              value={form.firecrawlApiKey}
              onChange={(e) =>
                setForm({ ...form, firecrawlApiKey: e.target.value })
              }
              placeholder="fc-..."
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.firecrawlKey.hint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="firecrawlApiUrl">
              <Globe size={16} className="inline mr-1" />
              Firecrawl API URL
            </Label>
            <Input
              id="firecrawlApiUrl"
              type="text"
              value={form.firecrawlApiUrl}
              onChange={(e) =>
                setForm({ ...form, firecrawlApiUrl: e.target.value })
              }
              placeholder="https://api.firecrawl.dev"
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.firecrawlUrl.hint}
            </p>
          </div>
        </>
      )}
    </>
  );
}

/* ── Asset Search Tab ── */

function AssetSearchTab({
  form,
  setForm,
}: {
  form: AssetSearchSettings;
  setForm: (v: AssetSearchSettings) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="assetEngine">
          <Search size={16} className="inline mr-1" />
          {t.settings.assetSearch.engine}
        </Label>
        <Select
          value={form.engine}
          onValueChange={(v) => setForm({ ...form, engine: v as any })}
        >
          <SelectTrigger id="assetEngine" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disabled">
              {t.settings.assetSearch.disabled}
            </SelectItem>
            <SelectItem value="pixabay">Pixabay</SelectItem>
            <SelectItem value="unsplash">Unsplash</SelectItem>
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          {t.settings.assetSearch.desc}
        </p>
      </div>

      {form.engine === "pixabay" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="pixabayApiKey">
              <Key size={16} className="inline mr-1" />
              Pixabay API Key
            </Label>
            <Input
              id="pixabayApiKey"
              type="password"
              value={form.pixabayApiKey}
              onChange={(e) =>
                setForm({ ...form, pixabayApiKey: e.target.value })
              }
              placeholder="..."
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.pixabayKey.hint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pixabayApiUrl">
              <Globe size={16} className="inline mr-1" />
              Pixabay API URL
            </Label>
            <Input
              id="pixabayApiUrl"
              type="text"
              value={form.pixabayApiUrl}
              onChange={(e) =>
                setForm({ ...form, pixabayApiUrl: e.target.value })
              }
              placeholder="https://pixabay.com/api"
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.pixabayUrl.hint}
            </p>
          </div>
        </>
      )}

      {form.engine === "unsplash" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="unsplashApiKey">
              <Key size={16} className="inline mr-1" />
              Unsplash API Key
            </Label>
            <Input
              id="unsplashApiKey"
              type="password"
              value={form.unsplashApiKey}
              onChange={(e) =>
                setForm({ ...form, unsplashApiKey: e.target.value })
              }
              placeholder="..."
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.unsplashKey.hint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unsplashApiUrl">
              <Globe size={16} className="inline mr-1" />
              Unsplash API URL
            </Label>
            <Input
              id="unsplashApiUrl"
              type="text"
              value={form.unsplashApiUrl}
              onChange={(e) =>
                setForm({ ...form, unsplashApiUrl: e.target.value })
              }
              placeholder="https://api.unsplash.com"
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.unsplashUrl.hint}
            </p>
          </div>
        </>
      )}
    </>
  );
}

/* ── Server Service Tab ── */

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

function ServerServiceTab({
  form,
  setForm,
}: {
  form: ServerServiceSettings;
  setForm: React.Dispatch<React.SetStateAction<ServerServiceSettings>>;
}) {
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
        const handleError = <T extends unknown[]>(fallback: T) => (err: unknown): T => {
          if (isAuthError(err)) return [] as unknown as T;
          console.error(err);
          return fallback;
        };

        const [_models, _search, _assets] = await Promise.all([
          fetchServerModels().catch(handleError(cache?.models ?? [])),
          fetchSearchProviders().catch(handleError(cache?.searchProviders ?? [])),
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
      patchServerServiceCache({ [cacheKey]: data } as Partial<ServerServiceCache>);
    } catch (err) {
      if (isAuthError(err)) {
        patchServerServiceCache({ [cacheKey]: [] } as Partial<ServerServiceCache>);
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
    refreshProvider(fetchSearchProviders, setIsRefreshingSearch, "searchProviders");
  const refreshAsset = () =>
    refreshProvider(fetchAssetProviders, setIsRefreshingAsset, "assetProviders");

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
          placeholder={t.settings.serverService.providerDefault || "Default (Auto)"}
          defaultOptionLabel={t.settings.serverService.providerDefault || "Default (Auto)"}
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
          placeholder={t.settings.serverService.providerDefault || "Default (Auto)"}
          defaultOptionLabel={t.settings.serverService.providerDefault || "Default (Auto)"}
          onRefresh={refreshAsset}
          refreshing={isRefreshingAsset}
          hint={t.settings.serverService.assetSearchDesc}
        />
      </div>
    </>
  );
}

/* ── System Settings Tab ── */

function SystemTab({
  form,
  setForm,
}: {
  form: SystemSettings;
  setForm: (v: SystemSettings) => void;
}) {
  const t = useT();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleReset = async () => {
    useSettingsStore.getState().resetAll();
    useConversationStore.persist.clearStorage();
    useSnapshotStore.persist.clearStorage();
    useMemoryStore.persist.clearStorage();
    await localforage.clear();

    window.location.reload();
  };

  return (
    <>
      {/* 语言 */}
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

      {/* 外观 */}
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

      {/* 反向代理 (仅 Tauri 环境) */}
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

      {/* 重置系统 */}
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

      {/* 版本 */}
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

/* ── Capsule Button Group ── */

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
