// ============================================================================
//  project-guidelines.ts
//  Reads root-level AI spec files (AGENTS.md / CLAUDE.md / DESIGN.md) from the
//  virtual project and turns them into a system-prompt section so the model
//  treats them as binding project constraints. Read-only consumption.
// ============================================================================

import type { ProjectFiles } from "./generator-types";

// Recognized root-level filenames, lowercase. Display order is the array order:
// agent rules first, design specs last.
const GUIDELINE_FILES = ["agents.md", "claude.md", "design.md"] as const;

const MAX_PER_FILE = 24000;

/** Build the project-guidelines block for the system prompt.
 *  Scans only the project root (paths without a slash) for the recognized
 *  spec files, case-insensitively. Returns "" when none are present. */
export function buildProjectGuidelinesSection(files: ProjectFiles): string {
  const matched: Array<{ name: string; content: string }> = [];

  for (const target of GUIDELINE_FILES) {
    const path = Object.keys(files).find(
      (p) => !p.includes("/") && p.toLowerCase() === target,
    );
    if (!path) continue;

    const raw = files[path];
    if (!raw || !raw.trim()) continue;

    const content =
      raw.length > MAX_PER_FILE
        ? raw.slice(0, MAX_PER_FILE) + "\n\n…[truncated, file too long]"
        : raw;
    matched.push({ name: path, content });
  }

  if (matched.length === 0) return "";

  const blocks = matched
    .map(({ name, content }) => `### ${name}\n\n${content}`)
    .join("\n\n");

  return `\n\n<project_guidelines>
The following files in the project root define authoritative project-specific
constraints, conventions and design specifications. Treat them as binding rules
that take precedence over your generic defaults. Re-read and follow them before
writing or modifying any code. If a guideline conflicts with the user's explicit
current request, follow the user's request and note the conflict.

${blocks}
</project_guidelines>`;
}
