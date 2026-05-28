import { tool } from "ai";
import { z } from "zod";
import type { ProjectFiles, FileChange } from "../ai/generator-types";
import { basename } from "./file-refs";

const DEFAULT_REGISTRY_BASE = "https://ui.shadcn.com/r";
const DEFAULT_STYLE = "styles/new-york";

interface RegistryItem {
  name: string;
  type?: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  files?: Array<{ path: string; content?: string; type?: string; target?: string }>;
  tailwind?: { config?: Record<string, unknown> };
  cssVars?: Record<string, Record<string, string>>;
}

export const INSTALL_COMPONENT_TOOL = {
  install_component: tool({
    description:
      "Install a shadcn/ui component (or third-party shadcn-compatible registry component) by name. " +
      "Auto-fetches component code, recursively resolves registryDependencies, merges npm dependencies " +
      "into package.json, and writes files to src/components/ui/ (or as specified by the registry). " +
      "Use this instead of hand-writing shadcn components — it guarantees correct deps and paths.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("Component name, e.g. 'button', 'dialog', 'data-table'"),
      registry_url: z
        .string()
        .optional()
        .describe(
          "Custom registry base URL (without trailing slash or style suffix). " +
            "Defaults to https://ui.shadcn.com/r (which serves /styles/new-york/<name>.json).",
        ),
      overwrite: z
        .boolean()
        .optional()
        .describe(
          "Overwrite if a target file already exists. Default: false (existing files are kept).",
        ),
    }),
  }),
};

export interface InstallComponentDeps {
  getFiles: () => ProjectFiles;
  onFilesChanged: (newFiles: ProjectFiles, changes: FileChange[]) => void;
}

interface InstallArgs {
  name: string;
  registry_url?: string;
  overwrite?: boolean;
}

function buildItemUrl(base: string, name: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (/\/styles\/[\w-]+$/.test(trimmed)) {
    return `${trimmed}/${name}.json`;
  }
  return `${trimmed}/${DEFAULT_STYLE}/${name}.json`;
}

async function fetchRegistryItem(
  base: string,
  name: string,
): Promise<RegistryItem | { error: string }> {
  const url = buildItemUrl(base, name);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      if (res.status === 404) {
        return { error: `component "${name}" not found in registry (HTTP 404 at ${url})` };
      }
      return { error: `HTTP ${res.status} fetching ${url}` };
    }
    const json = (await res.json()) as RegistryItem;
    if (!json || typeof json !== "object") {
      return { error: `invalid JSON response from ${url}` };
    }
    return json;
  } catch (err: any) {
    return { error: `fetch failed for ${url}: ${err?.message ?? "unknown error"}` };
  }
}

function mapTargetPath(file: { path: string; target?: string }, componentName: string): string {
  if (file.target && file.target.trim()) {
    return file.target.replace(/^\/+/, "");
  }
  const p = file.path.replace(/^\/+/, "");
  if (p.startsWith("ui/")) return `src/components/${p}`;
  if (p.startsWith("hooks/")) return `src/${p}`;
  if (p.startsWith("lib/")) return `src/${p}`;
  if (p.startsWith("components/")) return `src/${p}`;
  return `src/components/${componentName}/${basename(p)}`;
}

function mergePackageJson(
  existing: string | undefined,
  npmDeps: Set<string>,
  devDeps: Set<string>,
): { content: string; changed: boolean } | { error: string } {
  let parsed: Record<string, any>;
  if (existing) {
    try {
      parsed = JSON.parse(existing);
    } catch {
      return { error: "existing package.json is not valid JSON" };
    }
  } else {
    parsed = { name: "app", version: "0.0.0", dependencies: {}, devDependencies: {} };
  }

  parsed.dependencies = parsed.dependencies ?? {};
  parsed.devDependencies = parsed.devDependencies ?? {};

  let changed = false;
  for (const dep of npmDeps) {
    if (!parsed.dependencies[dep]) {
      parsed.dependencies[dep] = "latest";
      changed = true;
    }
  }
  for (const dep of devDeps) {
    if (!parsed.devDependencies[dep] && !parsed.dependencies[dep]) {
      parsed.devDependencies[dep] = "latest";
      changed = true;
    }
  }

  return { content: JSON.stringify(parsed, null, 2) + "\n", changed };
}

export function createInstallComponentHandler(deps: InstallComponentDeps) {
  return async (_name: string, args: unknown): Promise<string> => {
    const parsed = args as InstallArgs;
    const componentName = parsed?.name;
    if (!componentName || typeof componentName !== "string") {
      return JSON.stringify({ ok: false, error: "missing 'name' argument" });
    }

    const base = parsed.registry_url || DEFAULT_REGISTRY_BASE;
    const overwrite = parsed.overwrite ?? false;

    const visited = new Set<string>();
    let layer = [componentName];
    const items: RegistryItem[] = [];
    while (layer.length > 0) {
      const toFetch = layer.filter((n) => !visited.has(n));
      for (const n of toFetch) visited.add(n);
      const results = await Promise.all(
        toFetch.map((n) => fetchRegistryItem(base, n)),
      );
      const nextLayer: string[] = [];
      for (const item of results) {
        if ("error" in item) {
          return JSON.stringify({ ok: false, error: item.error });
        }
        items.push(item);
        for (const sub of item.registryDependencies ?? []) {
          if (!visited.has(sub)) nextLayer.push(sub);
        }
      }
      layer = nextLayer;
    }

    const npmDeps = new Set<string>();
    const devDeps = new Set<string>();
    for (const item of items) {
      for (const d of item.dependencies ?? []) npmDeps.add(d);
      for (const d of item.devDependencies ?? []) devDeps.add(d);
    }

    const files = deps.getFiles();
    const newFiles: ProjectFiles = { ...files };
    const changes: FileChange[] = [];
    const writtenPaths: string[] = [];
    const skippedPaths: string[] = [];

    for (const item of items) {
      for (const f of item.files ?? []) {
        if (typeof f.content !== "string") continue;
        const targetPath = mapTargetPath(f, item.name);
        if (targetPath in newFiles && !overwrite) {
          skippedPaths.push(targetPath);
          continue;
        }
        const action: FileChange["action"] = targetPath in files ? "modified" : "created";
        newFiles[targetPath] = f.content;
        changes.push({ path: targetPath, action });
        writtenPaths.push(targetPath);
      }
    }

    const pkgPath =
      Object.keys(newFiles).find((p) => p === "package.json" || p.endsWith("/package.json")) ||
      "package.json";
    const pkgMerge = mergePackageJson(newFiles[pkgPath], npmDeps, devDeps);
    if ("error" in pkgMerge) {
      return JSON.stringify({ ok: false, error: pkgMerge.error });
    }
    let dependenciesChanged = false;
    if (pkgMerge.changed) {
      const action: FileChange["action"] = pkgPath in files ? "modified" : "created";
      newFiles[pkgPath] = pkgMerge.content;
      changes.push({ path: pkgPath, action });
      dependenciesChanged = true;
    }

    deps.onFilesChanged(newFiles, changes);

    const installedNames = items.map((i) => i.name);
    return JSON.stringify({
      ok: true,
      installed: installedNames,
      writtenFiles: writtenPaths,
      skippedFiles: skippedPaths,
      packageJsonUpdated: dependenciesChanged,
      addedDependencies: Array.from(npmDeps),
      addedDevDependencies: Array.from(devDeps),
    });
  };
}
