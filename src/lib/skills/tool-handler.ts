import type { SkillRegistry } from "./registry";
import type { SkillEntry } from "./types";
import type { ScriptExecutor } from "./script-executor";
import {
  normalizeScriptResult,
  validateScriptExecuteParams,
} from "./script-execution-guard";
import { SKILL_TOOL_NAMES } from "./tools";

export interface SkillToolDeps {
  getRegistry: () => Promise<SkillRegistry>;
  getExecutor: () => Promise<ScriptExecutor>;
  /** Called after a successful read_skill. Caller can activate allowed-tools whitelist. */
  onActivate?: (skill: SkillEntry) => void;
}

function findByName(
  registry: SkillRegistry,
  name: string,
): SkillEntry | undefined {
  const enabled = registry.getEnabled();
  return (
    enabled.find((s) => s.name === name) ?? enabled.find((s) => s.id === name)
  );
}

function parseScriptArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("'args' must be an array of strings.");
  }
  if (!value.every((arg) => typeof arg === "string")) {
    throw new Error("'args' must be an array of strings.");
  }
  return value;
}

export function createSkillToolHandler(
  deps: SkillToolDeps,
): (name: string, args: unknown) => Promise<string> {
  return async (name, args) => {
    if (name === SKILL_TOOL_NAMES.LIST) {
      const registry = await deps.getRegistry();
      const skills = registry.getEnabled();
      if (skills.length === 0) {
        return "No skills are currently enabled.";
      }
      const lines = skills.map(
        (s) =>
          `- ${s.name}: ${s.description}` +
          (s.allowedTools && s.allowedTools.length > 0
            ? ` (allowed-tools: ${s.allowedTools.join(", ")})`
            : ""),
      );
      return `Enabled skills (${skills.length}):\n${lines.join("\n")}`;
    }

    if (name === SKILL_TOOL_NAMES.READ) {
      const { name: skillName } = args as { name: string };
      if (!skillName) return "Error: 'name' is required.";
      const registry = await deps.getRegistry();
      const skill = findByName(registry, skillName);
      if (!skill) {
        return `Error: skill "${skillName}" not found or not enabled.`;
      }
      const body = await registry.readSkillContent(skill.id);
      const references = await registry.listReferences(skill.id);
      const scripts = await registry.listScripts(skill.id);
      const sections: string[] = [];
      sections.push(`# Skill: ${skill.name}`);
      sections.push(body.trim());
      if (references.length > 0) {
        sections.push(
          `\n## References available\n${references.map((r) => `- ${r} (call read_skill again or ask the user to share if you need the full content)`).join("\n")}`,
        );
      }
      if (scripts.length > 0) {
        sections.push(
          `\n## Scripts available\n${scripts.map((s) => `- ${s} — invoke via execute_skill_script with skill_name="${skill.name}" and script_path="${s}"`).join("\n")}`,
        );
      }
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        sections.push(
          `\n## Tool restriction\nThis skill declares allowed-tools: ${skill.allowedTools.join(", ")}. ` +
            `Until the next user message, only these tools (plus flow tools like ask_user_question / exit_plan_mode / list_skills / read_skill / execute_skill_script / dispatch_subagent / compact_context) are available.`,
        );
        deps.onActivate?.(skill);
      }
      return sections.join("\n");
    }

    if (name === SKILL_TOOL_NAMES.EXECUTE_SCRIPT) {
      const {
        skill_name: skillName,
        script_path: scriptPath,
        args: rawScriptArgs,
      } = args as { skill_name: string; script_path: string; args?: unknown };
      if (!skillName || !scriptPath) {
        return "Error: 'skill_name' and 'script_path' are required.";
      }
      let scriptArgs: string[];
      try {
        scriptArgs = parseScriptArgs(rawScriptArgs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: ${msg}`;
      }
      const registry = await deps.getRegistry();
      const skill = findByName(registry, skillName);
      if (!skill) {
        return `Error: skill "${skillName}" not found or not enabled.`;
      }
      let scriptContent: string;
      try {
        scriptContent = await registry.readScript(skill.id, scriptPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: cannot read script "${scriptPath}" in skill "${skillName}": ${msg}`;
      }
      const executor = await deps.getExecutor();
      if (!executor.canExecute(scriptPath)) {
        return `Error: no executor available for script "${scriptPath}" in this environment.`;
      }
      try {
        const executionParams = {
          skillId: skill.id,
          scriptPath,
          scriptContent,
          args: scriptArgs,
        };
        validateScriptExecuteParams(executionParams);
        const result = normalizeScriptResult(await executor.execute(executionParams));
        const parts: string[] = [];
        parts.push(`Exit code: ${result.exitCode}`);
        if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
        if (result.stdoutTruncated) {
          parts.push("[stdout truncated]");
        }
        if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
        if (result.stderrTruncated) {
          parts.push("[stderr truncated]");
        }
        return parts.join("\n\n");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: script execution failed: ${msg}`;
      }
    }

    return `Error: unknown skill tool "${name}"`;
  };
}

export function buildSkillsPromptSection(enabled: SkillEntry[]): string {
  if (enabled.length === 0) return "";
  const lines = enabled.map((s) => {
    const allowed =
      s.allowedTools && s.allowedTools.length > 0
        ? ` (suggested tools: ${s.allowedTools.join(", ")})`
        : "";
    return `- **${s.name}**${allowed}: ${s.description}`;
  });
  return `\n\n<skills>
## Available skills
You have access to the following installed skills. Each is a focused knowledge pack the user has enabled.
When the user's request matches a skill's domain, call \`read_skill\` to load its full guidance before doing the work.
Call \`list_skills\` if you need a fresh listing.

${lines.join("\n")}
</skills>`;
}
