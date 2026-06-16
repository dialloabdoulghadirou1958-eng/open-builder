import { useEffect, useMemo, useState } from "react";
import { Plus, X, AlertTriangle, FolderOpen, Inbox, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useSkillsStore } from "../../store/skills";
import { useT } from "../../i18n";
import { getSkillRegistry } from "../../lib/skills/instance";
import { isSkillsAvailable, isTauri } from "../../lib/skills/fs";
import type { ImportResult } from "../../lib/skills/importer";
import {
  filterAndSortSkillCatalog,
  summarizeSkillCatalog,
  type SkillCatalogFilter,
  type SkillCatalogSort,
} from "../../lib/skills/catalog";
import { SkillCard } from "./SkillCard";
import { SkillImporter } from "./SkillImporter";

interface SkillsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface DetailsState {
  references: string[];
  scripts: string[];
}

interface LastImport {
  name: string;
  warnings: string[];
}

export function SkillsPanel({ open, onClose }: SkillsPanelProps) {
  const t = useT();
  const skills = useSkillsStore((s) => s.skills);
  const setSkillEnabled = useSkillsStore((s) => s.setSkillEnabled);
  const acknowledgeScriptWarning = useSkillsStore(
    (s) => s.acknowledgeScriptWarning,
  );
  const scriptWarningAcknowledged = useSkillsStore(
    (s) => s.scriptWarningAcknowledged,
  );
  const [showImporter, setShowImporter] = useState(false);
  const [detailsMap, setDetailsMap] = useState<Record<string, DetailsState>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const [query, setQuery] = useState("");
  const [catalogFilter, setCatalogFilter] =
    useState<SkillCatalogFilter>("all");
  const [catalogSort, setCatalogSort] =
    useState<SkillCatalogSort>("recommended");

  useEffect(() => {
    if (!open) {
      setShowImporter(false);
      setError(null);
      setPendingDeleteId(null);
      setLastImport(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isSkillsAvailable()) return;
    getSkillRegistry().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    });
  }, [open]);

  useEffect(() => {
    if (!open || !isSkillsAvailable()) return;
    const missingIds = Object.keys(skills).filter((id) => !detailsMap[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    getSkillRegistry()
      .then(async (registry) => {
        const entries = await Promise.all(
          missingIds.map(async (id) => {
            try {
              const [references, scripts] = await Promise.all([
                registry.listReferences(id),
                registry.listScripts(id),
              ]);
              return [id, { references, scripts }] as const;
            } catch {
              return [
                id,
                { references: [] as string[], scripts: [] as string[] },
              ] as const;
            }
          }),
        );
        if (cancelled) return;
        setDetailsMap((prev) => {
          const next = { ...prev };
          for (const [id, details] of entries) {
            if (!next[id]) next[id] = details;
          }
          return next;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailsMap, open, skills]);

  const skillEntries = useMemo(() => Object.values(skills), [skills]);

  const catalogItems = useMemo(
    () =>
      filterAndSortSkillCatalog(skillEntries, detailsMap, {
        query,
        filter: catalogFilter,
        sort: catalogSort,
      }),
    [catalogFilter, catalogSort, detailsMap, query, skillEntries],
  );

  const catalogSummary = useMemo(
    () => summarizeSkillCatalog(skillEntries, detailsMap),
    [detailsMap, skillEntries],
  );

  const filterOptions: Array<{ value: SkillCatalogFilter; label: string }> = [
    { value: "all", label: t.skills.market.filters.all },
    { value: "enabled", label: t.skills.market.filters.enabled },
    { value: "builtin", label: t.skills.market.filters.builtin },
    { value: "imported", label: t.skills.market.filters.imported },
    { value: "scripts", label: t.skills.market.filters.scripts },
  ];

  const sortOptions: Array<{ value: SkillCatalogSort; label: string }> = [
    { value: "recommended", label: t.skills.market.sort.recommended },
    { value: "updated", label: t.skills.market.sort.updated },
    { value: "permissions", label: t.skills.market.sort.permissions },
  ];

  const catalogStats = useMemo(
    () => [
      `${catalogSummary.enabled} ${t.skills.market.enabled}`,
      `${catalogSummary.imported} ${t.skills.imported}`,
      `${catalogSummary.withScripts} ${t.skills.market.withScripts}`,
    ],
    [
      catalogSummary.enabled,
      catalogSummary.imported,
      catalogSummary.withScripts,
      t.skills.imported,
      t.skills.market.enabled,
      t.skills.market.withScripts,
    ],
  );

  const handleToggle = (id: string, enabled: boolean) => {
    setSkillEnabled(id, enabled);
  };

  const requestDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      const registry = await getSkillRegistry();
      await registry.deleteSkill(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRequestDetails = async (id: string) => {
    try {
      const registry = await getSkillRegistry();
      const [references, scripts] = await Promise.all([
        registry.listReferences(id),
        registry.listScripts(id),
      ]);
      setDetailsMap((prev) => ({ ...prev, [id]: { references, scripts } }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onImported = (result: ImportResult) => {
    setShowImporter(false);
    setError(null);
    setLastImport({ name: result.entry.name, warnings: result.warnings });
  };

  const hasAnyScripts = catalogSummary.withScripts > 0;

  const isTauriEnv = isTauri();
  const pendingDeleteSkill = pendingDeleteId ? skills[pendingDeleteId] : null;

  const handleRevealInFiles = async () => {
    try {
      const { revealSkillsRoot } = await import(
        "../../lib/skills/tauri-folder-import"
      );
      await revealSkillsRoot();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t.skills.title}</DialogTitle>
            <DialogDescription>{t.skills.description}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {catalogSummary.total === 0
                ? t.skills.empty
                : `${catalogSummary.enabled} / ${catalogSummary.total}`}
            </p>
            <div className="flex items-center gap-1">
              {isTauriEnv && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleRevealInFiles}
                  title={t.skills.revealInFiles}
                >
                  <FolderOpen size={14} /> {t.skills.revealInFiles}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={showImporter ? "secondary" : "default"}
                onClick={() => setShowImporter((v) => !v)}
              >
                {showImporter ? (
                  <>
                    <X size={14} /> {t.skills.importer.cancel}
                  </>
                ) : (
                  <>
                    <Plus size={14} /> {t.skills.import}
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.skills.market.search}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {filterOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={
                    catalogFilter === option.value ? "secondary" : "ghost"
                  }
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setCatalogFilter(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1 overflow-x-auto">
                {sortOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={
                      catalogSort === option.value ? "secondary" : "ghost"
                    }
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => setCatalogSort(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="shrink-0 text-[11px] text-muted-foreground">
                {catalogStats.join(" · ")}
              </p>
            </div>
          </div>

          {showImporter && (
            <>
              <Separator />
              <SkillImporter onImported={onImported} />
              <Separator />
            </>
          )}

          {lastImport && (
            <div className="border border-green-500/20 bg-green-500/10 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-green-700 dark:text-green-400">
                {t.skills.importer.successOne.replace("{name}", lastImport.name)}
              </p>
              {lastImport.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t.skills.importer.warningsHeader}
                  </p>
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                    {lastImport.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {hasAnyScripts && !scriptWarningAcknowledged && (
            <div className="border border-amber-500/20 bg-amber-500/10 rounded-lg p-3 flex gap-2">
              <AlertTriangle
                size={16}
                className="text-amber-600 shrink-0 mt-0.5"
              />
              <div className="flex-1 space-y-2">
                <p className="text-xs font-medium">{t.skills.scriptWarning.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t.skills.scriptWarning.body}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={acknowledgeScriptWarning}
                >
                  {t.skills.scriptWarning.acknowledge}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3 flex gap-2">
              <AlertTriangle
                size={16}
                className="text-destructive shrink-0 mt-0.5"
              />
              <p className="text-xs text-destructive whitespace-pre-wrap flex-1">
                {error}
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {catalogItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Inbox size={28} className="mb-2 opacity-60" />
                <p className="text-sm">
                  {catalogSummary.total === 0
                    ? t.skills.empty
                    : t.skills.market.emptySearch}
                </p>
              </div>
            ) : (
              catalogItems.map((item) => {
                const { skill, ...catalog } = item;
                return (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    catalog={catalog}
                    onToggleEnabled={handleToggle}
                    onDelete={requestDelete}
                    details={detailsMap[skill.id]}
                    onRequestDetails={handleRequestDetails}
                  />
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {pendingDeleteSkill && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingDeleteId(null);
          }}
        >
          <DialogContent className="sm:max-w-sm" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>
                {t.skills.confirmDelete.replace(
                  "{name}",
                  pendingDeleteSkill.name,
                )}
              </DialogTitle>
              <DialogDescription>
                {t.skills.confirmDeleteDesc}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPendingDeleteId(null)}
              >
                {t.skills.cancel}
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                {t.skills.delete}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
