import { describe, expect, it } from "vitest";
import {
  FS_TOOL_LIMITS,
  fsInitProject,
  fsPatchFile,
  fsReadFiles,
  fsRenameFile,
  fsSearchInFiles,
  fsWriteFile,
  normalizeProjectPath,
} from "./fs-tools";
import { ENV_TOOL_LIMITS, fsManageEnv } from "./env-tools";
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

  it("rejects empty patch search strings", () => {
    const files: ProjectFiles = {
      "src/App.tsx": "export const title = 'stable';\n",
    };

    const result = fsPatchFile(
      "src/App.tsx",
      [{ search: "", replace: "oops" }],
      files,
    );

    expect(result.result).toContain("search must not be empty");
    expect(result.changes).toEqual([]);
    expect(result.newFiles).toBeUndefined();
  });

  it("rejects patched files that exceed the file size budget", () => {
    const files: ProjectFiles = {
      "src/App.tsx": "small",
    };

    const result = fsPatchFile(
      "src/App.tsx",
      [{ search: "small", replace: "x".repeat(FS_TOOL_LIMITS.maxFileBytes + 1) }],
      files,
    );

    expect(result.result).toContain("patched file file content exceeds");
    expect(result.changes).toEqual([]);
    expect(result.newFiles).toBeUndefined();
  });
});

describe("fsReadFiles", () => {
  it("limits read batch size and truncates large output", () => {
    const manyPaths = Array.from(
      { length: FS_TOOL_LIMITS.maxReadFiles + 1 },
      (_, i) => `src/${i}.ts`,
    );

    expect(fsReadFiles(manyPaths, {}).result).toContain(
      `at most ${FS_TOOL_LIMITS.maxReadFiles} files`,
    );

    const result = fsReadFiles(
      ["src/large.ts"],
      { "src/large.ts": "x".repeat(FS_TOOL_LIMITS.maxReadOutputChars + 100) },
    );

    expect(result.result).toContain("[truncated after");
    expect(result.changes).toEqual([]);
  });
});

describe("fsWriteFile", () => {
  it("rejects files that exceed the file size budget", () => {
    const result = fsWriteFile(
      "src/large.ts",
      "x".repeat(FS_TOOL_LIMITS.maxFileBytes + 1),
      {},
    );

    expect(result.result).toContain("file content exceeds");
    expect(result.changes).toEqual([]);
    expect(result.newFiles).toBeUndefined();
  });
});

describe("fsSearchInFiles", () => {
  it("limits search results", () => {
    const files: ProjectFiles = {
      "src/large.ts": Array.from(
        { length: FS_TOOL_LIMITS.maxSearchMatches + 10 },
        (_, i) => `const match${i} = true;`,
      ).join("\n"),
    };

    const result = fsSearchInFiles("match", files);

    expect(result.result).toContain("[truncated after");
    expect(result.result.split("\n").length).toBeLessThanOrEqual(
      FS_TOOL_LIMITS.maxSearchMatches + 1,
    );
  });

  it("rejects unsafe or oversized regex patterns", () => {
    expect(
      fsSearchInFiles("x".repeat(FS_TOOL_LIMITS.maxSearchPatternChars + 1), {})
        .result,
    ).toContain("pattern is too long");

    expect(fsSearchInFiles("(a+)+$", { "src/a.ts": "aaaa" }).result).toContain(
      "nested quantifiers",
    );
  });

  it("bounds scanned content for project-wide search", () => {
    const files: ProjectFiles = {
      "src/huge.ts": `${"x".repeat(FS_TOOL_LIMITS.maxSearchLineChars + 200)}needle`,
      "src/late.ts": "needle",
    };

    const result = fsSearchInFiles("needle", files);

    expect(result.result).toContain("src/late.ts");
    expect(result.result).not.toContain("src/huge.ts");

    const manyFiles = Object.fromEntries(
      Array.from({ length: FS_TOOL_LIMITS.maxSearchFiles + 5 }, (_, i) => [
        `src/${i}.ts`,
        "needle",
      ]),
    );
    expect(fsSearchInFiles("missing", manyFiles).result).toContain(
      "[truncated after",
    );
  });
});

describe("fsRenameFile", () => {
  it("rejects destinations that would merge into existing folders", () => {
    const files: ProjectFiles = {
      "src/components/Button.tsx": "button",
      "src/ui/Card.tsx": "card",
    };

    const result = fsRenameFile("src/components", "src/ui", files);

    expect(result.result).toContain("destination already exists");
    expect(result.changes).toEqual([]);
    expect(result.newFiles).toBeUndefined();
  });

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
      '"VITE_API_URL": z.string().url().optional()',
    );
  });

  it("rejects invalid env keys, missing values, and oversized values", () => {
    expect(
      fsManageEnv(
        [{ target: "example", action: "set", key: "BAD-KEY", value: "x" }],
        true,
        {},
      ).result,
    ).toContain("invalid env key");

    expect(
      fsManageEnv(
        [{ target: "env", action: "set", key: "MISSING_VALUE" }],
        true,
        {},
      ).result,
    ).toContain("require a string value");

    expect(
      fsManageEnv(
        [
          {
            target: "env",
            action: "set",
            key: "HUGE_VALUE",
            value: "x".repeat(ENV_TOOL_LIMITS.maxValueBytes + 1),
          },
        ],
        true,
        {},
      ).result,
    ).toContain("env values must be <=");
  });

  it("limits operation count and safely quotes generated schema keys", () => {
    const tooMany = Array.from(
      { length: ENV_TOOL_LIMITS.maxOperations + 1 },
      (_, i) => ({
        target: "example" as const,
        action: "set" as const,
        key: `VITE_KEY_${i}`,
        value: "x",
      }),
    );

    expect(fsManageEnv(tooMany, true, {}).result).toContain("at most");

    const result = fsManageEnv(
      [{ target: "example", action: "set", key: "VITE_SAFE", value: "x" }],
      true,
      { ".env.example": "LEGACY-KEY=x\n" },
    );

    expect(result.newFiles?.["src/env.ts"]).toContain('"LEGACY-KEY"');
    expect(result.newFiles?.["src/env.ts"]).toContain('"VITE_SAFE"');
  });
});
