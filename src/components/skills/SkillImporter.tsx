import { useRef, useState } from "react";
import { Upload, Link2, FolderTree, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useT } from "../../i18n";
import { getSkillRegistry } from "../../lib/skills/instance";
import {
  importFromFolder,
  importFromUrl,
  importFromZip,
  type ImportResult,
} from "../../lib/skills/importer";
import { isTauri } from "../../lib/skills/fs";

interface SkillImporterProps {
  onImported: (result: ImportResult) => void;
}

function hasDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: () => void })
      .showDirectoryPicker === "function"
  );
}

export function SkillImporter({ onImported }: SkillImporterProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tauriEnv = isTauri();
  const folderAvailable = tauriEnv || hasDirectoryPicker();

  const handleImport = async (
    run: () => Promise<ImportResult | null>,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await run();
      if (result) onImported(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t.skills.importer.failed.replace("{message}", msg));
    } finally {
      setBusy(false);
    }
  };

  const onPickZip = async (file: File) => {
    await handleImport(async () => {
      const buf = await file.arrayBuffer();
      const registry = await getSkillRegistry();
      return importFromZip(registry, buf);
    });
  };

  const onImportUrl = async () => {
    if (!url.trim()) return;
    await handleImport(async () => {
      const registry = await getSkillRegistry();
      return importFromUrl(registry, url.trim());
    });
  };

  const onPickFolder = async () => {
    await handleImport(async () => {
      const registry = await getSkillRegistry();
      if (tauriEnv) {
        const { importFolderViaTauri } = await import(
          "../../lib/skills/tauri-folder-import"
        );
        return importFolderViaTauri(registry);
      }
      const dirHandle = await (
        window as unknown as {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker();
      return importFromFolder(registry, dirHandle);
    });
  };

  return (
    <div className="space-y-3">
      <Tabs defaultValue="zip">
        <TabsList className="w-full">
          <TabsTrigger value="zip" disabled={busy}>
            {t.skills.importer.tabs.zip}
          </TabsTrigger>
          <TabsTrigger value="url" disabled={busy}>
            {t.skills.importer.tabs.url}
          </TabsTrigger>
          <TabsTrigger value="folder" disabled={busy}>
            {t.skills.importer.tabs.folder}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="zip" className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">
            {t.skills.importer.zipHint}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickZip(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {busy ? t.skills.importer.importing : t.skills.importer.pickZip}
          </Button>
        </TabsContent>
        <TabsContent value="url" className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">
            {t.skills.importer.urlHint}
          </p>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder={t.skills.importer.urlPlaceholder}
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || !url.trim()}
              onClick={onImportUrl}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Link2 size={14} />
              )}
              {busy ? t.skills.importer.importing : t.skills.importer.urlImport}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="folder" className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">
            {folderAvailable
              ? t.skills.importer.folderHint
              : t.skills.importer.folderUnavailable}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !folderAvailable}
            onClick={onPickFolder}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FolderTree size={14} />
            )}
            {busy ? t.skills.importer.importing : t.skills.importer.pickFolder}
          </Button>
        </TabsContent>
      </Tabs>
      {error && (
        <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>
      )}
    </div>
  );
}
