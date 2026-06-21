import type {
  ScriptExecuteParams,
  ScriptExecutor,
  ScriptResult,
} from "./script-executor";
import {
  normalizeScriptResult,
  validateScriptExecuteParams,
} from "./script-execution-guard";
import { extension } from "./paths";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs";

interface PyodideInstance {
  runPythonAsync(code: string): Promise<unknown>;
  globals: {
    set(name: string, value: unknown): void;
  };
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
}

interface PyodideModule {
  loadPyodide(opts?: { indexURL?: string }): Promise<PyodideInstance>;
}

let pyodidePromise: Promise<PyodideInstance> | null = null;

async function getPyodide(): Promise<PyodideInstance> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    const mod = (await import(
      /* @vite-ignore */ PYODIDE_URL
    )) as PyodideModule;
    return mod.loadPyodide({
      indexURL: PYODIDE_URL.replace(/pyodide\.mjs$/, ""),
    });
  })();
  return pyodidePromise;
}

async function runJs(params: ScriptExecuteParams): Promise<ScriptResult> {
  const worker = new Worker(
    new URL("./skill-script-worker.ts", import.meta.url),
    { type: "module" },
  );
  try {
    return await new Promise<ScriptResult>((resolve, reject) => {
      const cleanup = () => {
        worker.terminate();
        if (params.signal) {
          params.signal.removeEventListener("abort", onAbort);
        }
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Script execution aborted"));
      };
      if (params.signal) {
        if (params.signal.aborted) {
          cleanup();
          reject(new Error("Script execution aborted"));
          return;
        }
        params.signal.addEventListener("abort", onAbort);
      }
      worker.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as {
          type: "result";
          stdout: string;
          stderr: string;
          exitCode: number;
        };
        cleanup();
        resolve({
          stdout: data.stdout,
          stderr: data.stderr,
          exitCode: data.exitCode,
        });
      });
      worker.addEventListener("error", (event) => {
        cleanup();
        reject(new Error(event.message || "Worker error"));
      });
      worker.postMessage({
        type: "run",
        code: params.scriptContent,
        args: params.args,
      });
    });
  } catch (err) {
    worker.terminate();
    throw err;
  }
}

async function runPython(params: ScriptExecuteParams): Promise<ScriptResult> {
  const pyodide = await getPyodide();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  pyodide.setStdout({ batched: (s: string) => stdoutChunks.push(s) });
  pyodide.setStderr({ batched: (s: string) => stderrChunks.push(s) });
  pyodide.globals.set("__skill_args__", params.args);
  try {
    await pyodide.runPythonAsync(
      `import sys\nsys.argv = [${JSON.stringify(params.scriptPath)}] + list(__skill_args__)\n${params.scriptContent}`,
    );
    return {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      exitCode: 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      stdout: stdoutChunks.join(""),
      stderr: [stderrChunks.join(""), msg].filter(Boolean).join("\n"),
      exitCode: 1,
    };
  }
}

export const WebScriptExecutor: ScriptExecutor = {
  canExecute(scriptPath: string): boolean {
    const ext = extension(scriptPath);
    return ext === "js" || ext === "mjs" || ext === "py";
  },
  async execute(params: ScriptExecuteParams): Promise<ScriptResult> {
    validateScriptExecuteParams(params);
    const ext = extension(params.scriptPath);
    const result = ext === "py" ? await runPython(params) : await runJs(params);
    return normalizeScriptResult(result);
  },
};
