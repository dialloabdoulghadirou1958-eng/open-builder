import type {
  ScriptExecuteParams,
  ScriptExecutor,
  ScriptResult,
} from "./script-executor";
import { extension } from "./paths";

interface ChildProcess {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ShellModule {
  Command: {
    create(program: string, args: string[]): {
      execute(): Promise<ChildProcess>;
    };
  };
}

const SHELL_MODULE_ID = "@tauri-apps/plugin-shell";
let shellPromise: Promise<ShellModule | null> | null = null;

async function getShell(): Promise<ShellModule | null> {
  if (shellPromise) return shellPromise;
  shellPromise = (async () => {
    try {
      const mod = (await import(
        /* @vite-ignore */ SHELL_MODULE_ID
      )) as unknown as ShellModule;
      return mod;
    } catch {
      return null;
    }
  })();
  return shellPromise;
}

function programFor(ext: string): string | null {
  if (ext === "py") return "python3";
  if (ext === "js" || ext === "mjs") return "node";
  if (ext === "sh") return "sh";
  return null;
}

export const TauriScriptExecutor: ScriptExecutor = {
  canExecute(scriptPath: string): boolean {
    return programFor(extension(scriptPath)) !== null;
  },
  async execute(params: ScriptExecuteParams): Promise<ScriptResult> {
    const ext = extension(params.scriptPath);
    const program = programFor(ext);
    if (!program) {
      return {
        stdout: "",
        stderr: `No interpreter mapping for extension ".${ext}"`,
        exitCode: 1,
      };
    }
    const shell = await getShell();
    if (!shell) {
      return {
        stdout: "",
        stderr:
          "@tauri-apps/plugin-shell is not installed. Run `pnpm add @tauri-apps/plugin-shell` and enable the shell plugin in src-tauri.",
        exitCode: 1,
      };
    }

    const scriptArgs = ["-c", params.scriptContent, ...params.args];
    if (ext === "js" || ext === "mjs") {
      scriptArgs[0] = "-e";
    }
    try {
      const child = await shell.Command.create(program, scriptArgs).execute();
      return {
        stdout: child.stdout ?? "",
        stderr: child.stderr ?? "",
        exitCode: child.code ?? -1,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stdout: "",
        stderr: `Failed to invoke ${program}: ${msg}`,
        exitCode: 1,
      };
    }
  },
};
