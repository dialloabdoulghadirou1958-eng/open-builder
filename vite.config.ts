import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => {
  return {
    base: process.env.VITE_BASE_PATH ?? "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 5173,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 5173,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (
              id.includes("@codesandbox/sandpack-react") ||
              id.includes("@codesandbox+sandpack-react") ||
              id.includes("react-devtools-inline") ||
              id.includes("@react-hook") ||
              id.includes("@stitches")
            ) {
              return "vendor-sandpack-react";
            }
            if (
              id.includes("@codesandbox/") ||
              id.includes("@codesandbox+") ||
              id.includes("mime-db") ||
              id.includes("mime-types") ||
              id.includes("cuid") ||
              id.includes("anser") ||
              id.includes("clean-set") ||
              id.includes("dequal") ||
              id.includes("escape-carriage") ||
              id.includes("lz-string")
            ) {
              return "vendor-sandpack-runtime";
            }
            if (
              id.includes("@codemirror") ||
              id.includes("@lezer") ||
              id.includes("codemirror")
            ) {
              return "vendor-editor";
            }
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("radix-ui") || id.includes("@radix-ui")) {
              return "vendor-radix";
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
            if (
              id.includes("react-markdown") ||
              id.includes("remark-") ||
              id.includes("rehype-") ||
              id.includes("highlight.js") ||
              id.includes("micromark") ||
              id.includes("unified") ||
              id.includes("mdast") ||
              id.includes("hast") ||
              id.includes("unist") ||
              id.includes("vfile")
            ) {
              return "vendor-markdown";
            }
            if (
              id.includes("@ai-sdk/openai-compatible") ||
              id.includes("@ai-sdk+openai-compatible")
            ) {
              return "vendor-ai-openai-compatible";
            }
            if (
              id.includes("@ai-sdk/anthropic") ||
              id.includes("@ai-sdk+anthropic")
            ) {
              return "vendor-ai-anthropic";
            }
            if (
              id.includes("@ai-sdk/google") ||
              id.includes("@ai-sdk+google")
            ) {
              return "vendor-ai-google";
            }
            if (
              id.includes("@ai-sdk/openai") ||
              id.includes("@ai-sdk+openai")
            ) {
              return "vendor-ai-openai";
            }
            if (
              id.includes("@ai-sdk") ||
              id.includes("/ai/") ||
              id.includes("/zod/")
            ) {
              return "vendor-ai";
            }
            if (
              id.includes("zustand") ||
              id.includes("localforage") ||
              id.includes("file-saver") ||
              id.includes("jszip") ||
              id.includes("diff") ||
              id.includes("js-yaml") ||
              id.includes("react-resizable-panels") ||
              id.includes("class-variance-authority") ||
              id.includes("tailwind-merge") ||
              id.includes("clsx")
            ) {
              return "vendor-utils";
            }
          },
        },
      },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
  };
});
