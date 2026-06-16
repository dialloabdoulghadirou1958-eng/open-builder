import { describe, expect, it, vi } from "vitest";
import { createSkillToolHandler } from "./tool-handler";
import { SKILL_TOOL_NAMES } from "./tools";
import type { SkillEntry } from "./types";
import type { SkillRegistry } from "./registry";
import type { ScriptExecutor } from "./script-executor";

const skill: SkillEntry = {
  id: "skill-1",
  name: "demo-skill",
  description: "Demo skill",
  version: "1.0.0",
  enabled: true,
  source: "imported",
  installedAt: 1,
};

function createRegistry(): SkillRegistry {
  return {
    getEnabled: () => [skill],
    readScript: vi.fn(async () => "console.log('ok')"),
  } as unknown as SkillRegistry;
}

describe("createSkillToolHandler", () => {
  it("records script execution audit data on success", async () => {
    const onScriptExecuted = vi.fn();
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => ({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      })),
    };
    const handler = createSkillToolHandler({
      getRegistry: async () => createRegistry(),
      getExecutor: async () => executor,
      onScriptExecuted,
    });

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
      args: ["world"],
    });

    expect(result).toContain("Exit code: 0");
    expect(onScriptExecuted).toHaveBeenCalledWith(
      expect.objectContaining({
        skill,
        scriptPath: "hello.js",
        args: ["world"],
        result: expect.objectContaining({ exitCode: 0 }),
      }),
    );
  });

  it("records script execution audit data when execution throws", async () => {
    const onScriptExecuted = vi.fn();
    const executor: ScriptExecutor = {
      canExecute: () => true,
      execute: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const handler = createSkillToolHandler({
      getRegistry: async () => createRegistry(),
      getExecutor: async () => executor,
      onScriptExecuted,
    });

    const result = await handler(SKILL_TOOL_NAMES.EXECUTE_SCRIPT, {
      skill_name: "demo-skill",
      script_path: "hello.js",
    });

    expect(result).toContain("Error: script execution failed: boom");
    expect(onScriptExecuted).toHaveBeenCalledWith(
      expect.objectContaining({
        skill,
        scriptPath: "hello.js",
        args: [],
        result: null,
      }),
    );
  });
});
