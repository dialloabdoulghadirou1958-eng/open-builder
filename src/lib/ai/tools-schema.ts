// ============================================================================
//  ai-tools.ts
//  Zod-based 工具定义 —— 使用 AI SDK tool() + Zod schema 定义所有内置工具
// ============================================================================

import { tool } from "ai";
import { z } from "zod";

/**
 * 内置工具定义（Zod 格式）
 * 这些工具的执行逻辑仍在 generator.ts 的 executeTool 中，
 * 这里只定义 schema，不提供 execute 回调。
 */
export const BUILTIN_TOOLS = {
  init_project: tool({
    description:
      "Initialize the project with a Sandpack template. Call this FIRST when starting a new project. " +
      "Available templates: " +
      "static (plain HTML/CSS/JS), " +
      "vanilla (vanilla JS with bundler), " +
      "vanilla-ts (vanilla TypeScript), " +
      "react (React with JavaScript), " +
      "react-ts (React with TypeScript, DEFAULT), " +
      "vue (Vue 3 with JavaScript), " +
      "vue-ts (Vue 3 with TypeScript), " +
      "svelte (Svelte with JavaScript), " +
      "angular (Angular with TypeScript), " +
      "solid (SolidJS with TypeScript), " +
      "vite (Vite vanilla), " +
      "vite-react (Vite + React JS), " +
      "vite-react-ts (Vite + React TypeScript), " +
      "vite-vue (Vite + Vue JS), " +
      "vite-vue-ts (Vite + Vue TypeScript), " +
      "vite-svelte (Vite + Svelte JS), " +
      "vite-svelte-ts (Vite + Svelte TypeScript), " +
      "astro (Astro), " +
      "test-ts (TypeScript test runner).",
    inputSchema: z.object({
      template: z.string().describe("Template name from the available list"),
    }),
  }),

  manage_dependencies: tool({
    description:
      "Add, remove, or update project dependencies by modifying package.json. " +
      "This triggers a full project restart to install the new dependencies. " +
      "Provide the complete updated package.json content.",
    inputSchema: z.object({
      package_json: z
        .string()
        .describe("The complete package.json content to write"),
    }),
  }),

  list_files: tool({
    description:
      "List all file paths currently in the project. Returns one path per line, or '(empty)' if no files exist.",
    inputSchema: z.object({}),
  }),

  read_files: tool({
    description:
      "Read and return the full content of multiple files at once. Always prefer this over calling read_file multiple times.",
    inputSchema: z.object({
      paths: z
        .array(z.string())
        .describe("List of file paths relative to project root"),
    }),
  }),

  write_file: tool({
    description:
      "Create a new file or completely overwrite an existing file with the provided content.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to project root"),
      content: z.string().describe("The complete file content to write"),
    }),
  }),

  patch_file: tool({
    description:
      "Apply one or more search-and-replace patches to an existing file. " +
      "Each patch replaces the FIRST occurrence of the search string. " +
      "Include enough surrounding context in 'search' to ensure uniqueness.",
    inputSchema: z.object({
      path: z.string().describe("File path to patch"),
      patches: z
        .array(
          z.object({
            search: z
              .string()
              .describe("Exact text to find (must be unique in the file)"),
            replace: z.string().describe("Text to replace the match with"),
          }),
        )
        .describe("Ordered list of search-and-replace operations"),
    }),
  }),

  search_in_files: tool({
    description: "Search for a regex pattern across all project files",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern"),
    }),
  }),

  delete_file: tool({
    description: "Delete a file from the project.",
    inputSchema: z.object({
      path: z.string().describe("File path to delete"),
    }),
  }),

  rename_file: tool({
    description:
      "Rename or move a file (or directory prefix) to a new path. " +
      "ALWAYS auto-updates relative-path import references (./, ../) across " +
      ".ts/.tsx/.js/.jsx/.mjs/.cjs/.vue/.svelte/.css/.scss files, so callers do not need " +
      "to follow up with patch_file to fix imports. Path-alias imports (e.g. '@/foo') are NOT updated yet. " +
      "Use this instead of write_file + delete_file when changing a file's location.",
    inputSchema: z.object({
      old_path: z.string().describe("Current file path relative to project root"),
      new_path: z.string().describe("New file path relative to project root"),
    }),
  }),

  move_file: tool({
    description:
      "Move a file into another directory, preserving its file name. " +
      "Auto-updates relative-path import references just like rename_file.",
    inputSchema: z.object({
      path: z.string().describe("Source file path"),
      target_dir: z
        .string()
        .describe("Target directory (empty string = project root)"),
    }),
  }),

  read_env_schema: tool({
    description:
      "Inspect the project's environment variable schema. " +
      "Returns the keys declared in .env.example, whether each is set in .env, " +
      "and whether it is public (VITE_*) or private. Values are NOT returned for safety.",
    inputSchema: z.object({}),
  }),

  manage_env: tool({
    description:
      "Read/write the project's .env and .env.example. " +
      "Use this instead of write_file when touching env files — it parses lines safely, " +
      "preserves existing keys, and (by default) auto-generates a typed src/env.ts " +
      "with a Zod schema so the project gets type-safe env access. " +
      "Mark public keys with the VITE_ prefix (vite convention).",
    inputSchema: z.object({
      operations: z
        .array(
          z.object({
            target: z
              .enum(["env", "example"])
              .describe('"env" writes to .env; "example" writes to .env.example'),
            action: z.enum(["set", "unset"]),
            key: z.string().describe("Variable name, e.g. DATABASE_URL"),
            value: z
              .string()
              .optional()
              .describe('Value for "set" actions; ignored for "unset"'),
          }),
        )
        .min(1)
        .describe("Ordered list of env operations to apply"),
      generate_typed_env: z
        .boolean()
        .optional()
        .describe(
          "Auto-generate src/env.ts (Zod schema + type) after applying ops. Default: true.",
        ),
    }),
  }),

  get_console_logs: tool({
    description:
      "Get the browser console output from the running Sandpack preview. " +
      "Use this after finishing code changes to check for runtime errors, warnings, or syntax errors. " +
      "If errors are found, fix them immediately.",
    inputSchema: z.object({}),
  }),

  compact_context: tool({
    description:
      "Compress the conversation context to reduce token usage. " +
      "Call this when the conversation is getting long and you sense the context may be approaching limits, " +
      "or when earlier messages contain verbose content no longer needed in full detail. " +
      "This summarizes older messages while preserving key information.",
    inputSchema: z.object({}),
  }),

  ask_user_question: tool({
    description:
      "Ask the user 1-4 clarifying questions when the requirements are genuinely ambiguous, " +
      "before making assumptions or starting implementation. " +
      "Use this when a key product decision is unclear (which framework, which auth method, which layout style, etc.) " +
      "and guessing would likely waste work. Do NOT use it for trivial confirmations. " +
      "Each question must offer 2-4 distinct, mutually exclusive options. " +
      "The user can also type a free-text 'Other' answer if no option fits.",
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            question: z
              .string()
              .describe(
                "The full question text the user will read. Should end with '?'.",
              ),
            header: z
              .string()
              .describe(
                "Short tag/label shown on the question card (<=12 chars), e.g. 'Auth method'.",
              ),
            multiSelect: z
              .boolean()
              .describe(
                "If true the user may pick more than one option. Default false.",
              ),
            options: z
              .array(
                z.object({
                  label: z
                    .string()
                    .describe("Short option title (1-5 words) the user picks."),
                  description: z
                    .string()
                    .describe(
                      "One sentence explaining what choosing this option means.",
                    ),
                }),
              )
              .min(2)
              .max(4)
              .describe("2-4 mutually exclusive option choices."),
          }),
        )
        .min(1)
        .max(4)
        .describe("List of 1-4 questions to ask the user in one batch."),
    }),
  }),

  exit_plan_mode: tool({
    description:
      "Present the implementation plan to the user for approval. " +
      "Call this as the FINAL step of planning, only after you have thoroughly explored " +
      "the existing project (list_files / read_files / search_in_files) and resolved " +
      "any ambiguity (ask_user_question if needed). " +
      "The plan must be clear Markdown that covers: what files will change, what dependencies " +
      "will be added, and the overall approach. " +
      "When this tool returns 'approved', proceed directly to implementation. " +
      "When it returns 'rejected', revise based on the user's feedback and call exit_plan_mode again. " +
      "Do NOT output the plan as a normal text reply - it MUST be delivered via this tool.",
    inputSchema: z.object({
      plan: z
        .string()
        .describe(
          "The complete implementation plan in Markdown. Include sections like Context, Approach, Files to change, and Verification.",
        ),
    }),
  }),
};

// Builtin tool names that mutate project files. Single source of truth used by
// plan-mode filtering (useGenerator) and the subagent readonly policy (runner).
export const BUILTIN_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "init_project",
  "manage_dependencies",
  "write_file",
  "patch_file",
  "delete_file",
  "rename_file",
  "move_file",
  "manage_env",
  "install_component",
  "screenshot_to_code",
  "apply_design_style",
]);
