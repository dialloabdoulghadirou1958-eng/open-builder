import { useState, useEffect, useCallback, useRef } from "react";
import { Key, Globe, Cpu, RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../../store/settings";
import type { AISettings } from "../../../store/settings";
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
} from "@/lib/ai/provider";
import type { ApiType } from "@/lib/ai/provider";
import { useT } from "../../../i18n";

const API_ENDPOINTS: Record<ApiType, string> = {
  "openai-compatible": "/chat/completions",
  openai: "/responses",
  anthropic: "/messages",
  google: "/models",
};

interface ModelTabProps {
  formData: AISettings;
  setFormData: (v: AISettings) => void;
}

export function ModelTab({ formData, setFormData }: ModelTabProps) {
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
