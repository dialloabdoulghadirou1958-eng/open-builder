import { isTauri } from "./fs";
import { WebScriptExecutor } from "./script-executor-web";
import { TauriScriptExecutor } from "./script-executor-tauri";

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ScriptExecuteParams {
  skillId: string;
  scriptPath: string;
  scriptContent: string;
  args: string[];
  signal?: AbortSignal;
}

export interface ScriptExecutor {
  canExecute(scriptPath: string): boolean;
  execute(params: ScriptExecuteParams): Promise<ScriptResult>;
}

export const scriptExecutor: ScriptExecutor = isTauri()
  ? TauriScriptExecutor
  : WebScriptExecutor;
