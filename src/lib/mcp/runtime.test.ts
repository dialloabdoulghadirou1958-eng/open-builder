import { describe, expect, it, vi } from "vitest";
import { approveMcpDiscovery } from "./fingerprint";
import { buildMcpRuntimeBundle } from "./runtime";
import { createMcpServerEntry } from "./validation";
import { createSkillActiveContext } from "../skills/active-context";
import { TOOL_POLICY_VERSION } from "../ai/tools-schema";
import type { ToolExecutionContext } from "../ai/generator-types";

function planContext(aliases: ReadonlySet<string>): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    toolCallId: "call-1",
    skillContext: createSkillActiveContext(),
    run: {
      runId: "run-1",
      mode: "plan",
      platform: "desktop",
      allowedMcpAliases: aliases,
      activeSkillIds: new Set(),
      approvedSkillScriptHashes: new Set(),
      policyVersion: TOOL_POLICY_VERSION,
    },
  };
}

async function approvedServer() {
  const base = createMcpServerEntry(
    {
      name: "Workspace",
      transport: "streamable-http",
      url: "https://mcp.example.com/rpc",
    },
    { id: "workspace", now: 1 },
  );
  const approved = await approveMcpDiscovery(
    base,
    {
      instructions: "Prefer the narrowest query.",
      tools: [
        {
          name: "read_record",
          description: "Read one record",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true },
        },
        {
          name: "delete_record",
          description: "Delete one record",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
      ],
    },
    { now: 2 },
  );
  approved.tools.read_record.allowInPlanMode = true;
  approved.tools.read_record.allowForSubagents = true;
  approved.tools.read_record.elevatedPermissionsPolicyVersion =
    TOOL_POLICY_VERSION;
  return approved;
}

describe("MCP runtime tool filtering", () => {
  it("exposes approved tools while granting plan and subagent access only to approved read-only tools", async () => {
    const server = await approvedServer();
    const callTool = vi.fn(async () => ({ text: "ok" }));
    const bundle = buildMcpRuntimeBundle({
      globalEnabled: true,
      servers: { workspace: server },
      runtime: {
        workspace: {
          status: "ready",
          instructions: server.instructions,
          drift: {
            status: "clean",
            added: [],
            removed: [],
            changed: [],
            instructionsChanged: false,
            currentFingerprint: server.definitionFingerprint!,
          },
          updatedAt: 3,
        },
      },
      caller: { callTool },
    });

    expect(Object.keys(bundle.tools)).toHaveLength(2);
    expect(bundle.planModeToolNames).toHaveLength(1);
    expect(bundle.subagentToolNames).toEqual(bundle.planModeToolNames);
    expect(bundle.instructions).toContain(
      "BEGIN UNTRUSTED MCP SERVER INSTRUCTIONS",
    );
    expect(bundle.instructions).toContain("Prefer the narrowest query.");

    const readAlias = [...bundle.planModeToolNames][0];
    await expect(
      bundle.handler(
        readAlias,
        { id: 1 },
        planContext(bundle.planModeToolNames),
      ),
    ).resolves.toEqual({
      text: "ok",
    });
    expect(callTool).toHaveBeenCalledWith(
      "workspace",
      "read_record",
      { id: 1 },
      expect.objectContaining({
        run: expect.objectContaining({ mode: "plan" }),
      }),
    );

    const destructiveAlias = [...bundle.aliases.entries()].find(
      ([, target]) => target.toolName === "delete_record",
    )![0];
    await expect(
      bundle.handler(
        destructiveAlias,
        { id: 1 },
        planContext(new Set([destructiveAlias])),
      ),
    ).resolves.toMatchObject({ isError: true });
    expect(callTool).toHaveBeenCalledTimes(1);

    await expect(bundle.handler(readAlias, { id: 2 })).resolves.toMatchObject({
      isError: true,
      text: expect.stringMatching(/without a tool execution context/i),
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("treats elevated grants from an older tool policy as unapproved", async () => {
    const server = await approvedServer();
    server.tools.read_record.elevatedPermissionsPolicyVersion = "stale-policy";
    const bundle = buildMcpRuntimeBundle({
      globalEnabled: true,
      servers: { workspace: server },
      runtime: {
        workspace: {
          status: "ready",
          drift: {
            status: "clean",
            added: [],
            removed: [],
            changed: [],
            instructionsChanged: false,
            currentFingerprint: server.definitionFingerprint!,
          },
          updatedAt: 3,
        },
      },
      caller: { callTool: vi.fn() },
    });

    expect(bundle.planModeToolNames).toEqual(new Set());
    expect(bundle.subagentToolNames).toEqual(new Set());
  });

  it("removes an entire drifted server instead of exposing stale tools", async () => {
    const server = await approvedServer();
    const bundle = buildMcpRuntimeBundle({
      globalEnabled: true,
      servers: { workspace: server },
      runtime: {
        workspace: {
          status: "drifted",
          drift: {
            status: "drifted",
            added: ["unexpected"],
            removed: [],
            changed: [],
            instructionsChanged: false,
            currentFingerprint: "changed",
          },
          updatedAt: 3,
        },
      },
      caller: { callTool: vi.fn() },
    });
    expect(bundle.tools).toEqual({});
    expect(bundle.instructions).toBe("");
  });
});
