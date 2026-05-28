import { tool, generateText } from "ai";
import { z } from "zod";
import { getProviderModel } from "../ai/provider";
import type { ApiType } from "../ai/provider";
import type { ProjectFiles, FileChange } from "../ai/generator-types";

export const SCREENSHOT_TO_CODE_TOOL = {
  screenshot_to_code: tool({
    description:
      "Generate a UI component from a screenshot or design image. " +
      "Calls a vision-capable model to analyze the image and produce framework-specific code, " +
      "then writes the result to the project. Use when the user provides an image of a UI they want built " +
      "and you want a single end-to-end generation step. " +
      "For minor tweaks afterwards, use patch_file / write_file directly.",
    inputSchema: z.object({
      image_url: z
        .string()
        .describe(
          "Image source: a base64 data URL (data:image/...;base64,...) or an http(s) URL.",
        ),
      framework: z
        .enum(["react", "vue", "svelte"])
        .optional()
        .describe("Target framework. Default: react"),
      style_hints: z
        .string()
        .optional()
        .describe(
          "Style guidance, e.g. 'Tailwind dark theme, shadcn/ui components, modern minimal'.",
        ),
      output_path: z
        .string()
        .optional()
        .describe(
          "Output file path. Defaults based on framework, e.g. src/components/GeneratedComponent.tsx",
        ),
    }),
  }),
};

export interface ScreenshotToCodeDeps {
  apiConfig: {
    apiType: ApiType;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
  };
  getFiles: () => ProjectFiles;
  onFilesChanged: (newFiles: ProjectFiles, changes: FileChange[]) => void;
}

interface ScreenshotArgs {
  image_url: string;
  framework?: "react" | "vue" | "svelte";
  style_hints?: string;
  output_path?: string;
}

const DEFAULT_OUTPUT: Record<NonNullable<ScreenshotArgs["framework"]>, string> = {
  react: "src/components/GeneratedComponent.tsx",
  vue: "src/components/GeneratedComponent.vue",
  svelte: "src/components/GeneratedComponent.svelte",
};

function buildPrompt(framework: string, styleHints?: string): string {
  const style = styleHints?.trim() || "Tailwind CSS";
  return [
    `You are an expert UI developer.`,
    `Analyze the provided UI screenshot and produce a single, complete, runnable ${framework} component`,
    `using ${style}. The component must be self-contained and visually faithful to the screenshot.`,
    ``,
    `Output requirements:`,
    `- Wrap the entire component in a single fenced code block (\`\`\`${framework === "react" ? "tsx" : framework}).`,
    `- Do NOT include any explanation, prose, or commentary outside the code block.`,
    `- Do NOT include placeholders or TODOs — produce working code.`,
    `- For React: default-export a function component named GeneratedComponent.`,
    `- For Vue: a single-file component with <script setup lang="ts"> and <template>.`,
    `- For Svelte: a single .svelte file with <script lang="ts"> and markup.`,
  ].join("\n");
}

function extractCodeBlock(text: string): string | null {
  const re = /```[\w]*\n([\s\S]+?)```/;
  const m = re.exec(text);
  if (m) return m[1].trim();
  const trimmed = text.trim();
  if (trimmed.length > 0) return trimmed;
  return null;
}

export function createScreenshotToCodeHandler(deps: ScreenshotToCodeDeps) {
  return async (_name: string, args: unknown): Promise<string> => {
    const parsed = args as ScreenshotArgs;
    const imageUrl = parsed?.image_url;
    if (!imageUrl || typeof imageUrl !== "string") {
      return JSON.stringify({ ok: false, error: "missing 'image_url' argument" });
    }
    const framework = parsed.framework ?? "react";
    const outputPath = parsed.output_path || DEFAULT_OUTPUT[framework];

    let model;
    try {
      model = getProviderModel(deps.apiConfig);
    } catch (err: any) {
      return JSON.stringify({
        ok: false,
        error: `failed to init model: ${err?.message ?? "unknown"}`,
      });
    }

    let text: string;
    try {
      const result = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(framework, parsed.style_hints) },
              { type: "image", image: imageUrl },
            ],
          },
        ],
        maxRetries: 0,
      });
      text = result.text || "";
    } catch (err: any) {
      return JSON.stringify({
        ok: false,
        error: `vision request failed: ${err?.message ?? "unknown"}`,
      });
    }

    const code = extractCodeBlock(text);
    if (!code) {
      return JSON.stringify({
        ok: false,
        error: "model did not return a code block",
      });
    }

    const files = deps.getFiles();
    const action: FileChange["action"] = outputPath in files ? "modified" : "created";
    const newFiles: ProjectFiles = { ...files, [outputPath]: code };
    deps.onFilesChanged(newFiles, [{ path: outputPath, action }]);

    return JSON.stringify({
      ok: true,
      path: outputPath,
      chars: code.length,
      preview: code.slice(0, 200),
    });
  };
}
