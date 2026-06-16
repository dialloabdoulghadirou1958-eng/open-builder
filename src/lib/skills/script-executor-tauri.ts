import type {
  ScriptExecuteParams,
  ScriptExecutor,
  ScriptResult,
} from "./script-executor";
import { extension } from "./paths";
import { invoke } from "@tauri-apps/api/core";

interface SkillScriptCommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
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
	    try {
	      const child = await invoke<SkillScriptCommandResult>("run_skill_script", {
	        req: {
	          script_path: params.scriptPath,
	          script_content: params.scriptContent,
	          args: params.args,
	        },
	      });
	      return {
	        stdout: child.stdout ?? "",
	        stderr: child.stderr ?? "",
	        exitCode: child.exit_code ?? -1,
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
