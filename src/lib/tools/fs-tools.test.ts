import { describe, expect, it } from "vitest";
import {
  fsInitProject,
  fsPatchFile,
  fsRenameFile,
  fsWriteFile,
  normalizeProjectPath,
} from "./fs-tools";
import { fsManageEnv } from "./env-tools";
import type { ProjectFiles } from "../ai/generator-types";

describe("fsInitProject", () => {
  it("initializes a Sandpack template with normalized file paths", async () => {
    const result = await fsInitProject("react-ts");

    expect(result.result).toContain(
      'OK — initialized project with template "react-ts"',
    );
    expect(result.templateChange).toEqual({ template: "react-ts" });
    expect(result.newFiles?.["App.tsx"]).toContain("export default");
    expect(Object.keys(result.newFiles ?? {}).every((p) => !p.startsWith("/")))
      .toBe(true);
	    expect(result.changes).toContainEqual({
	      path: "App.tsx",
	      action: "created",
	    });
	  });

  it("reports supported templates for unknown template names", async () => {
    const result = await fsInitProject("missing-template");

    expect(result.changes).toEqual([]);
    expect(result.result).toContain('Error: unknown template "missing-template"');
    expect(result.result).toContain("react-ts");
    expect(result.result).toContain("nextjs");
	});

describe("path safety", () => {
  it("rejects absolute paths and traversal", () => {
    expect(normalizeProjectPath("/etc/passwd")).toEqual({
      ok: false,
      error: 'absolute paths are not allowed — "/etc/passwd"',
    });
    expect(normalizeProjectPath("../secret")).toEqual({
      ok: false,
      error: 'path traversal is not allowed — "../secret"',
    });
  });

  it("requires manage_env for .env writes", () => {
    const result = fsWriteFile(".env", "SECRET=value\n", {});

    expect(result.changes).toEqual([]);
    expect(result.result).toContain("managed by manage_env");
  });
});
});

describe("fsPatchFile", () => {
  it("applies ordered search-and-replace patches and reports file changes", () => {
    const files: ProjectFiles = {
      "src/App.tsx": "export const title = 'old';\n",
    };

    const result = fsPatchFile(
      "src/App.tsx",
      [{ search: "'old'", replace: "'new'" }],
      files,
    );

    expect(result.changes).toEqual([
      { path: "src/App.tsx", action: "modified" },
    ]);
    expect(result.newFiles?.["src/App.tsx"]).toBe(
      "export const title = 'new';\n",
    );
  });

  it("does not modify files when no patch matches", () => {
    const files: ProjectFiles = {
      "src/App.tsx": "export const title = 'stable';\n",
    };

    const result = fsPatchFile(
      "src/App.tsx",
      [{ search: "'missing'", replace: "'new'" }],
      files,
    );

    expect(result.result).toContain("Error: none of 1 patches matched");
    expect(result.changes).toEqual([]);
    expect(result.newFiles).toBeUndefined();
  });
});

describe("fsRenameFile", () => {
  it("renames a directory and rewrites relative imports to moved files", () => {
    const files: ProjectFiles = {
      "src/App.tsx": [
        'import { Button } from "./components";',
        'import ButtonDirect from "./components/Button";',
        "export function App() { return <ButtonDirect />; }",
      ].join("\n"),
      "src/components/index.ts": 'export { Button } from "./Button";\n',
      "src/components/Button.tsx":
        "export function Button() { return <button />; }\n",
    };

    const result = fsRenameFile("src/components", "src/ui", files);

    expect(result.result).toContain("OK");
    expect(result.newFiles?.["src/components/Button.tsx"]).toBeUndefined();
    expect(result.newFiles?.["src/ui/Button.tsx"]).toContain(
      "export function Button",
    );
    expect(result.newFiles?.["src/App.tsx"]).toContain(
      'from "./ui";',
    );
    expect(result.newFiles?.["src/App.tsx"]).toContain(
      'from "./ui/Button";',
    );
    expect(result.newFiles?.["src/ui/index.ts"]).toBe(
      'export { Button } from "./Button";\n',
    );
  });
});

describe("fsManageEnv", () => {
  it("updates env files, generates typed env access, and warns for undeclared secrets", () => {
    const result = fsManageEnv(
      [
        {
          target: "example",
          action: "set",
          key: "VITE_API_URL",
          value: "https://example.com",
        },
        {
          target: "env",
          action: "set",
          key: "SECRET_TOKEN",
          value: "super-secret",
        },
      ],
      true,
      {},
    );

    expect(result.result).toContain("OK");
    expect(result.result).toContain("SECRET_TOKEN not declared");
    expect(result.newFiles?.[".env.example"]).toBe(
      "VITE_API_URL=https://example.com\n",
    );
    expect(result.newFiles?.[".env"]).toBe("SECRET_TOKEN=super-secret\n");
    expect(result.newFiles?.["src/env.ts"]).toContain(
      "VITE_API_URL: z.string().url().optional()",
    );
  });
});
