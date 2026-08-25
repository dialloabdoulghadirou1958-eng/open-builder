import { describe, expect, it, vi } from "vitest";
import {
  buildForcedSkillsPromptSection,
  buildSkillsPromptSection,
  createSkillToolHandler,
} from "./tool-handler";
import { SCRIPT_EXECUTION_LIMITS } from "./script-execution-guard";
import { SKILL_TOOL_NAMES } from "./tools";
import type { SkillEntry } from "./types";
import type { SkillRegistry } from "./registry";
import type { ScriptExecutor } from "./script-executor";

const skill: SkillEntry = {
  id: "skill-1",
  name: "demo-skill",
  description: "Demo skill",
  version: "1.0.0",
  autoEnabled: true,
  source: "imported",
  installedAt: 1,
};

function createRegistry(scriptContent = "console.log('ok')"): SkillRegistry {
  return {
    getAutoEnabled: () => [skill],
    list: () => [skill],
    readScript: vi.fn(async () => scriptContent),
  } as unknown as SkillRegistry;
}

function activeScriptDeps(executor: ScriptExecutor) {
  return {
    getRegistry: async () => createRegistry(),
    getExecutor: async () => executor,
    scriptExecutionEnabled: true,
    isSkillActive: () => true,
  };
}

describe("createSkillToolHandler", () => {
  it("reads a nested reference through read_skill", async () => {
    const registry = {
      getAutoEnabled: () => [skill],
      readReference: vi.fn(async () => "Reference body"),
    } as unknown as SkillRegistry;
    const handler = createSkillToolHandler({
      getRegistry: async () => registry,
      getExecutor: async () => ({
        canExecute: () => false,
        execute: vi.fn(),
      }),
    });

    const result = await handler(SKILL_TOOL_NAMES.READ, {
      name: "demo-skill",
      reference_path: "api/auth.md",
    });

    expect(result).toContain("Reference body");
    expect(registry.readReference).toHaveBeenCalledWith(
      "skill-1",
      "api/auth.md",
    );
  });

  it("lets an explicitly forced auto-disabled skill read a reference", async () => {
    const forcedSkill = { ...skill, autoEnabled: false };
    const registry = {
      getAutoEnabled: () => [],
      list: () => [forcedSkill],
      readReference: vi.fn(async () => "Forced reference"),
    } as unknown as SkillRegistry;
    const handler = createSkillToolHandler({
      getRegistry: async () => registry,
      getExecutor: async () => ({
        canExecute: () => false,
        execute: vi.fn(),
      }),
      isSkillActive: (id) => id === forcedSkill.id,
    });

    const result = await handler(SKILL_TOOL_NAMES.READ, {
      name: forcedSkill.id,
      reference_path: "nested/reference.md",
    });

    expect(result).toContain("Forced reference");
  });

  it("requires a skill to be active before executing its script", async () => {
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(),
    };
    const handler = createSkillToolHandler({
      getRegistry: async () => createRegistry(),
      getExecutor: async () => executor,
      scriptExecutionEnabled: true,
      isSkillActive: () => false,
    });

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
    });

    expect(result).toContain("must be loaded with read_skill");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("returns script execution output on success", async () => {
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => ({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      })),
    };
    const handler = createSkillToolHandler(activeScriptDeps(executor));

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
      args: ["world"],
    });

    expect(result).toContain("Exit code: 0");
  });

  it("returns an error when script execution throws", async () => {
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const handler = createSkillToolHandler(activeScriptDeps(executor));

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
    });

    expect(result).toContain("Error: script execution failed: boom");
  });

  it("rejects invalid script args before execution", async () => {
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => ({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      })),
    };
    const handler = createSkillToolHandler(activeScriptDeps(executor));

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
      args: ["ok", 123],
    });

    expect(result).toContain("Error: 'args' must be an array of strings.");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects oversized scripts before execution", async () => {
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => ({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      })),
    };
    const handler = createSkillToolHandler({
      getRegistry: async () =>
        createRegistry("x".repeat(SCRIPT_EXECUTION_LIMITS.maxScriptBytes + 1)),
      getExecutor: async () => executor,
      scriptExecutionEnabled: true,
      isSkillActive: () => true,
    });

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
    });

    expect(result).toContain("Error: script execution failed: script exceeds");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("truncates long script output before returning it to the model", async () => {
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => ({
        stdout: "o".repeat(SCRIPT_EXECUTION_LIMITS.maxOutputChars + 5),
        stderr: "",
        exitCode: 0,
      })),
    };
    const handler = createSkillToolHandler(activeScriptDeps(executor));

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
    });

    expect(result).toContain("[stdout truncated]");
    expect(result.length).toBeLessThan(
      SCRIPT_EXECUTION_LIMITS.maxOutputChars + 200,
    );
  });
});

describe("skills system prompts", () => {
  it("injects automatic metadata without the skill body", () => {
    const prompt = buildSkillsPromptSection([skill]);
    expect(prompt).toContain("demo-skill");
    expect(prompt).toContain("id: skill-1");
    expect(prompt).toContain("version: 1.0.0");
    expect(prompt).toContain("more than one skill");
    expect(prompt).not.toContain("Full body");
  });

  it("injects full forced skill instructions as mandatory context", () => {
    const prompt = buildForcedSkillsPromptSection([
      { entry: skill, content: "Full body" },
    ]);
    expect(prompt).toContain("<mandatory_skills>");
    expect(prompt).toContain("Full body");
    expect(prompt).toContain("ask_user_question");
  });
});
