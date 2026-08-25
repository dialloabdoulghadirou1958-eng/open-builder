import { describe, expect, it } from "vitest";
import type { ToolSet } from "ai";
import {
  BUILTIN_TOOLS,
  isPlanModeToolVisible,
  isWriteToolName,
} from "./tools-schema";
import { filterToolSet } from "../tools/tool-set-utils";

describe("tool policies", () => {
  it("marks custom file-writing tools as write tools", () => {
    expect(isWriteToolName("install_component")).toBe(true);
    expect(isWriteToolName("screenshot_to_code")).toBe(true);
    expect(isWriteToolName("apply_design_style")).toBe(true);
    expect(isWriteToolName("execute_skill_script")).toBe(true);
    expect(isWriteToolName("read_files")).toBe(false);
  });

  it("filters builtin and custom write tools in plan mode", () => {
    const custom = {
      install_component: {} as ToolSet[string],
      execute_skill_script: {} as ToolSet[string],
      project_health_check: {} as ToolSet[string],
    };
    const builtins = filterToolSet(BUILTIN_TOOLS, isPlanModeToolVisible);
    const customs = filterToolSet(custom, isPlanModeToolVisible);

    expect(builtins.write_file).toBeUndefined();
    expect(builtins.read_files).toBeDefined();
    expect(customs.install_component).toBeUndefined();
    expect(customs.execute_skill_script).toBeUndefined();
    expect(customs.project_health_check).toBeDefined();
  });
});
