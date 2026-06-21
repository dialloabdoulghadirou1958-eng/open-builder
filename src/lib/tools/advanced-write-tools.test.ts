import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplyDesignStyleHandler } from "./design-styles";
import { FS_TOOL_LIMITS } from "./fs-tools";
import { createInstallComponentHandler } from "./install-component";
import { createScreenshotToCodeHandler } from "./screenshot-to-code";
import type { ProjectFiles, FileChange } from "../ai/generator-types";

function captureFiles(initial: ProjectFiles = {}) {
  let files = initial;
  const changes: FileChange[][] = [];
  return {
    getFiles: () => files,
    onFilesChanged: (next: ProjectFiles, changeSet: FileChange[]) => {
      files = next;
      changes.push(changeSet);
    },
    getChanges: () => changes,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("advanced project write tools", () => {
  it("rejects unsafe component names before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const deps = captureFiles();
    const handler = createInstallComponentHandler(deps);

    const result = JSON.parse(
      await handler("install_component", { name: "../button" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("safe registry item name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid registry dependency names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "button",
            dependencies: ["react; rm -rf"],
            files: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const deps = captureFiles();
    const handler = createInstallComponentHandler(deps);

    const result = JSON.parse(
      await handler("install_component", { name: "button" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid dependency name");
    expect(deps.getChanges()).toHaveLength(0);
  });

  it("rejects unsafe component registry target paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "button",
            files: [{ path: "button.tsx", target: "../escape.ts", content: "x" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const deps = captureFiles();
    const handler = createInstallComponentHandler(deps);

    const result = JSON.parse(
      await handler("install_component", { name: "button" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("path traversal");
    expect(deps.getChanges()).toHaveLength(0);
  });

  it("rejects oversized component registry files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "button",
            files: [
              {
                path: "ui/button.tsx",
                content: "x".repeat(FS_TOOL_LIMITS.maxFileBytes + 1),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const deps = captureFiles();
    const handler = createInstallComponentHandler(deps);

    const result = JSON.parse(
      await handler("install_component", { name: "button" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("file content exceeds");
    expect(deps.getChanges()).toHaveLength(0);
  });

  it("validates screenshot output paths before initializing a model", async () => {
    const deps = captureFiles();
    const handler = createScreenshotToCodeHandler({
      ...deps,
      apiConfig: {
        apiType: "openai",
        apiBaseUrl: "https://example.com",
        apiKey: "key",
        model: "vision",
      },
    });

    const result = JSON.parse(
      await handler("screenshot_to_code", {
        image_url: "data:image/png;base64,abc",
        output_path: "../escape.tsx",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("path traversal");
    expect(deps.getChanges()).toHaveLength(0);
  });

  it("rejects oversized screenshot data URLs before initializing a model", async () => {
    const deps = captureFiles();
    const handler = createScreenshotToCodeHandler({
      ...deps,
      apiConfig: {
        apiType: "openai",
        apiBaseUrl: "https://example.com",
        apiKey: "key",
        model: "vision",
      },
    });

    const result = JSON.parse(
      await handler("screenshot_to_code", {
        image_url: `data:image/png;base64,${"x".repeat(6_000_001)}`,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("data URL is too large");
    expect(deps.getChanges()).toHaveLength(0);
  });

  it("rejects oversized design specs before writing files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("x".repeat(FS_TOOL_LIMITS.maxFileBytes + 1), {
          status: 200,
        }),
      ),
    );
    const deps = captureFiles();
    const handler = createApplyDesignStyleHandler(deps);

    const result = JSON.parse(
      await handler("apply_design_style", { style: "stripe" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("file content exceeds");
    expect(deps.getChanges()).toHaveLength(0);
  });
});
