import { SANDBOX_TEMPLATES } from "@codesandbox/sandpack-react";
import type {
  ProjectFiles,
  FileChange,
} from "../ai/generator-types";

export interface FsToolResult {
  result: string;
  changes: FileChange[];
  /** When set, the generator replaces its entire files map with this object
   *  (init_project semantics). */
  newFiles?: ProjectFiles;
  /** When true, signal a full project template change (with the template name). */
  templateChange?: { template: string };
  /** When true, signal a dependency change (manage_dependencies semantics). */
  dependenciesChanged?: boolean;
}

export function fsInitProject(template: string): FsToolResult {
  const tmpl = SANDBOX_TEMPLATES[template as keyof typeof SANDBOX_TEMPLATES];
  if (!tmpl) {
    return {
      result: `Error: unknown template "${template}". Use one of: ${Object.keys(SANDBOX_TEMPLATES).join(", ")}`,
      changes: [],
    };
  }
  const newFiles: ProjectFiles = {};
  const changes: FileChange[] = [];
  for (const [path, file] of Object.entries(tmpl.files)) {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const code =
      typeof file === "string" ? file : (file as { code: string }).code;
    newFiles[normalizedPath] = code;
    changes.push({ path: normalizedPath, action: "created" });
  }
  return {
    result: `OK — initialized project with template "${template}" (${Object.keys(newFiles).length} files)`,
    changes,
    newFiles,
    templateChange: { template },
  };
}

export function fsManageDependencies(
  packageJson: string,
  files: ProjectFiles,
): FsToolResult {
  try {
    JSON.parse(packageJson);
  } catch {
    return { result: "Error: invalid JSON in package_json", changes: [] };
  }
  const pkgPath =
    Object.keys(files).find((p) => p.endsWith("package.json")) ||
    "package.json";
  const action: FileChange["action"] =
    pkgPath in files ? "modified" : "created";
  return {
    result: `OK — ${action} ${pkgPath}, dependencies updated. Sandpack will restart.`,
    changes: [{ path: pkgPath, action }],
    newFiles: { ...files, [pkgPath]: packageJson },
    dependenciesChanged: true,
  };
}

export function fsListFiles(files: ProjectFiles): FsToolResult {
  const paths = Object.keys(files).sort();
  return {
    result: paths.length === 0 ? "(empty project — no files)" : paths.join("\n"),
    changes: [],
  };
}

export function fsReadFiles(
  paths: string[],
  files: ProjectFiles,
): FsToolResult {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { result: "Error: no paths provided", changes: [] };
  }
  const out = paths
    .map((path) => {
      if (!(path in files)) {
        return `=== ${path} ===\nError: file not found`;
      }
      return `=== ${path} ===\n${files[path]}`;
    })
    .join("\n\n");
  return { result: out, changes: [] };
}

export function fsWriteFile(
  path: string,
  content: string,
  files: ProjectFiles,
): FsToolResult {
  const action: FileChange["action"] = path in files ? "modified" : "created";
  return {
    result: `OK — ${action}: ${path} (${content.length} chars)`,
    changes: [{ path, action }],
    newFiles: { ...files, [path]: content },
  };
}

export function fsPatchFile(
  path: string,
  patches: Array<{ search: string; replace: string }>,
  files: ProjectFiles,
): FsToolResult {
  if (!(path in files)) {
    return { result: `Error: file not found — "${path}"`, changes: [] };
  }

  let content = files[path];
  const log: string[] = [];

  for (let i = 0; i < patches.length; i++) {
    const { search, replace } = patches[i];
    const idx = content.indexOf(search);

    if (idx >= 0) {
      content =
        content.slice(0, idx) + replace + content.slice(idx + search.length);
      log.push(`patch #${i + 1}: applied`);
    } else {
      const preview = search.length > 60 ? search.slice(0, 60) + "…" : search;
      log.push(`patch #${i + 1}: not found — "${preview}"`);
    }
  }

  return {
    result: log.join("\n"),
    changes: [{ path, action: "modified" }],
    newFiles: { ...files, [path]: content },
  };
}

export function fsSearchInFiles(
  pattern: string,
  files: ProjectFiles,
): FsToolResult {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch {
    return {
      result: `Error: invalid regex pattern — "${pattern}"`,
      changes: [],
    };
  }
  const results: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push(`${path}:${i + 1}: ${lines[i].trim()}`);
      }
      regex.lastIndex = 0;
    }
  }
  return {
    result: results.length > 0 ? results.join("\n") : "(no matches found)",
    changes: [],
  };
}

export function fsDeleteFile(
  path: string,
  files: ProjectFiles,
): FsToolResult {
  if (!(path in files)) {
    return { result: `Error: file not found — "${path}"`, changes: [] };
  }
  const newFiles = { ...files };
  delete newFiles[path];
  return {
    result: `OK — deleted: ${path}`,
    changes: [{ path, action: "deleted" }],
    newFiles,
  };
}

/** Dispatch a file-system tool call. Returns null if the tool is not a recognized fs tool. */
export function dispatchFsTool(
  name: string,
  args: any,
  files: ProjectFiles,
): FsToolResult | null {
  switch (name) {
    case "init_project":
      return fsInitProject(args.template);
    case "manage_dependencies":
      return fsManageDependencies(args.package_json, files);
    case "list_files":
      return fsListFiles(files);
    case "read_files":
      return fsReadFiles(args.paths, files);
    case "write_file":
      return fsWriteFile(args.path, args.content, files);
    case "patch_file": {
      const patches = Array.isArray(args.patches) ? args.patches : [args.patches];
      return fsPatchFile(args.path, patches, files);
    }
    case "delete_file":
      return fsDeleteFile(args.path, files);
    case "search_in_files":
      return fsSearchInFiles(args.pattern, files);
    default:
      return null;
  }
}
