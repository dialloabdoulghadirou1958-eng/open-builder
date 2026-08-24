import { useState, useEffect } from "react";
import type {
  AISettings,
  WebSearchSettings,
  AssetSearchSettings,
  SystemSettings,
} from "../../store/settings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useT } from "../../i18n";
import { ModelTab } from "./tabs/ModelTab";
import { SearchServicesTab } from "./tabs/SearchServicesTab";
import { SystemTab } from "./tabs/SystemTab";
import { StorageTab } from "./tabs/StorageTab";

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
}: SettingsDialogProps) {
  const t = useT();

  const [formData, setFormData] = useState<AISettings>(settings);
  const [webSearchForm, setWebSearchForm] =
    useState<WebSearchSettings>(webSearchSettings);
  const [assetSearchForm, setAssetSearchForm] =
    useState<AssetSearchSettings>(assetSearchSettings);
  const [systemForm, setSystemForm] = useState<SystemSettings>(systemSettings);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(settings);
    setWebSearchForm(webSearchSettings);
    setAssetSearchForm(assetSearchSettings);
    setSystemForm(systemSettings);
  }, [
    isOpen,
    settings,
    webSearchSettings,
    assetSearchSettings,
    systemSettings,
  ]);

  const handleSave = () => {
    onSave(formData);
    onSaveWebSearch(webSearchForm);
    onSaveAssetSearch(assetSearchForm);
    onSaveSystem(systemForm);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md sm:max-w-md max-h-[90dvh] flex flex-col">
        <DialogHeader className="shrink-0 px-2">
          <DialogTitle>{t.settings.title}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="model" className="flex-1 min-h-0 flex flex-col px-2">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="model" className="px-1.5 text-xs sm:px-2 sm:text-sm">
              {t.settings.tabs.model}
            </TabsTrigger>
            <TabsTrigger value="search" className="px-1.5 text-xs sm:px-2 sm:text-sm">
              {t.settings.tabs.search}
            </TabsTrigger>
            <TabsTrigger value="storage" className="px-1.5 text-xs sm:px-2 sm:text-sm">
              {t.settings.tabs.storage}
            </TabsTrigger>
            <TabsTrigger value="system" className="px-1.5 text-xs sm:px-2 sm:text-sm">
              {t.settings.tabs.system}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="model"
            className="min-h-0 overflow-y-auto py-4 pr-1 space-y-4"
          >
            <ModelTab formData={formData} setFormData={setFormData} />
          </TabsContent>

          <TabsContent
            value="search"
            className="min-h-0 overflow-y-auto py-4 pr-1 space-y-4"
          >
            <SearchServicesTab
              webSearchForm={webSearchForm}
              setWebSearchForm={setWebSearchForm}
              assetSearchForm={assetSearchForm}
              setAssetSearchForm={setAssetSearchForm}
              apiType={formData.apiType}
            />
          </TabsContent>

          <TabsContent
            value="storage"
            className="min-h-0 overflow-y-auto py-4 pr-1 space-y-4"
          >
            <StorageTab />
          </TabsContent>

          <TabsContent
            value="system"
            className="min-h-0 overflow-y-auto py-4 pr-1 space-y-4"
          >
            <SystemTab form={systemForm} setForm={setSystemForm} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 flex-row justify-end">
          <Button variant="outline" onClick={onClose}>
            {t.settings.cancel}
          </Button>
          <Button onClick={handleSave}>{t.settings.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
