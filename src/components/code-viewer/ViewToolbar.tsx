import {
  Eye,
  Code2,
  Monitor,
  Tablet,
  Smartphone,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useT } from "../../i18n";
import type { ProjectFiles } from "@/types";

export type ViewMode = "preview" | "code";
export type DeviceSize = "desktop" | "tablet" | "mobile";

interface ViewToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  deviceSize: DeviceSize;
  onDeviceSizeChange: (size: DeviceSize) => void;
  files: ProjectFiles;
}

async function downloadAsZip(files: ProjectFiles) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, "project.zip");
}

export function ViewToolbar({
  viewMode,
  onViewModeChange,
  deviceSize,
  onDeviceSizeChange,
  files,
}: ViewToolbarProps) {
  const t = useT();
  return (
    <div className="h-14 border-b bg-background px-4 flex items-center justify-between shrink-0 z-10">
      <div className="flex items-center gap-1 p-0.5 rounded-lg border">
        <Button
          variant={viewMode === "preview" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewModeChange("preview")}
          className="gap-2"
        >
          <Eye size={16} />
          {t.toolbar.preview}
        </Button>
        <Button
          variant={viewMode === "code" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewModeChange("code")}
          className="gap-2"
        >
          <Code2 size={16} />
          {t.toolbar.code}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {viewMode === "preview" && (
          <div className="flex items-center gap-1 p-0.5 rounded-lg border">
            <Button
              variant={deviceSize === "desktop" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => onDeviceSizeChange("desktop")}
              title={t.toolbar.desktop}
              aria-label={t.toolbar.desktop}
              className="desktop"
            >
              <Monitor size={16} />
            </Button>
            <Button
              variant={deviceSize === "tablet" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => onDeviceSizeChange("tablet")}
              title={t.toolbar.tablet}
              aria-label={t.toolbar.tablet}
              className="tablet"
            >
              <Tablet size={16} />
            </Button>
            <Button
              variant={deviceSize === "mobile" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => onDeviceSizeChange("mobile")}
              title={t.toolbar.mobile}
              aria-label={t.toolbar.mobile}
              className="mobile"
            >
              <Smartphone size={16} />
            </Button>
          </div>
        )}

        {viewMode === "code" && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => downloadAsZip(files)}
            title={t.toolbar.download}
            aria-label={t.toolbar.download}
          >
            <Download size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
