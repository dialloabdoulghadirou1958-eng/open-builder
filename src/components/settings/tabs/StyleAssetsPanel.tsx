import { useMemo, useState } from "react";
import { Palette, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useStyleAssetStore } from "../../../store/style-assets";
import {
  createStyleAsset,
  parseStyleAssetList,
} from "../../../lib/utils/style-assets";
import { useT } from "../../../i18n";

export function StyleAssetsPanel() {
  const t = useT();
  const assetRecord = useStyleAssetStore((s) => s.assets);
  const addAsset = useStyleAssetStore((s) => s.addAsset);
  const deleteAsset = useStyleAssetStore((s) => s.deleteAsset);
  const setAssetEnabled = useStyleAssetStore((s) => s.setAssetEnabled);
  const assets = useMemo(
    () => Object.values(assetRecord).sort((a, b) => b.updatedAt - a.updatedAt),
    [assetRecord],
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [colors, setColors] = useState("");
  const [typography, setTypography] = useState("");
  const [radius, setRadius] = useState("");
  const [spacing, setSpacing] = useState("");
  const [tags, setTags] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstructions("");
    setColors("");
    setTypography("");
    setRadius("");
    setSpacing("");
    setTags("");
  };

  const handleSave = () => {
    if (!name.trim()) return;
    addAsset(
      createStyleAsset({
        id: crypto.randomUUID(),
        name,
        description,
        instructions,
        tokens: {
          colors: parseStyleAssetList(colors),
          typography,
          radius,
          spacing,
        },
        tags: parseStyleAssetList(tags),
        now: Date.now(),
      }),
    );
    resetForm();
    setNotice(t.settings.styleAssets.saved);
  };

  const handleDelete = (assetId: string) => {
    if (!window.confirm(t.settings.styleAssets.deleteConfirm)) return;
    deleteAsset(assetId);
  };

  return (
    <div className="space-y-2">
      <Label>
        <Palette size={16} className="inline mr-1" />
        {t.settings.styleAssets.label}
      </Label>
      <div className="rounded-md border border-border bg-muted/30 p-2 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.settings.styleAssets.name}
            className="col-span-2 h-8 text-xs"
          />
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.settings.styleAssets.description}
            className="col-span-2 h-8 text-xs"
          />
          <Input
            value={colors}
            onChange={(event) => setColors(event.target.value)}
            placeholder={t.settings.styleAssets.colors}
            className="h-8 text-xs"
          />
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={t.settings.styleAssets.tags}
            className="h-8 text-xs"
          />
          <Input
            value={typography}
            onChange={(event) => setTypography(event.target.value)}
            placeholder={t.settings.styleAssets.typography}
            className="h-8 text-xs"
          />
          <Input
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            placeholder={t.settings.styleAssets.radius}
            className="h-8 text-xs"
          />
          <Input
            value={spacing}
            onChange={(event) => setSpacing(event.target.value)}
            placeholder={t.settings.styleAssets.spacing}
            className="col-span-2 h-8 text-xs"
          />
        </div>
        <Textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t.settings.styleAssets.instructions}
          className="min-h-20 resize-none text-xs"
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-2 px-3 text-xs"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            <Save size={13} />
            {t.settings.styleAssets.save}
          </Button>
          {notice && (
            <p className="text-[11px] text-muted-foreground">{notice}</p>
          )}
        </div>

        <div className="border-t">
          {assets.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              {t.settings.styleAssets.empty}
            </p>
          ) : (
            <div className="divide-y">
              {assets.map((asset) => (
                <div key={asset.id} className="flex items-start gap-2 py-2">
                  <Switch
                    size="sm"
                    checked={asset.enabled}
                    onCheckedChange={(checked) =>
                      setAssetEnabled(asset.id, checked)
                    }
                    aria-label={t.settings.styleAssets.toggle}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-xs font-medium">
                        {asset.name}
                      </p>
                      {asset.tags.slice(0, 2).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="max-w-20 truncate"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {asset.description && (
                      <p className="line-clamp-2 text-[11px] text-muted-foreground">
                        {asset.description}
                      </p>
                    )}
                    {asset.tokens.colors.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {asset.tokens.colors.slice(0, 8).map((color) => (
                          <span
                            key={color}
                            className="size-3 rounded-sm border border-border"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(asset.id)}
                    aria-label={t.settings.styleAssets.delete}
                    title={t.settings.styleAssets.delete}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
