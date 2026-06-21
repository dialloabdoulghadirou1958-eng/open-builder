import { tool } from "ai";
import { z } from "zod";
import type { MemoryItem, MemoryOperation } from "../../types";
import {
  limitMemoriesForPrompt,
  sanitizeMemoryOperations,
} from "../utils/memory-limits";

export interface MemoryDeps {
  getAll: () => MemoryItem[];
  processBatch: (operations: MemoryOperation[]) => string;
}

// ═══════════════════════════════ Constants ═══════════════════════════════════

export const MEMORY_TOOL_NAME = "manage_memories";

// ═══════════════════════════════ Tool Definition ═════════════════════════════

export const MEMORY_TOOLS = {
  [MEMORY_TOOL_NAME]: tool({
    description:
      "Save, update, or delete user memories. Call this when you discover important " +
      "information about the user during conversation, such as their preferences, " +
      "personal details, instructions for your behavior, or long-term relevant facts. " +
      "Supports batch operations: you can add new memories, update existing ones " +
      "(to resolve conflicts or refine), and delete outdated ones in a single call. " +
      "Do NOT save temporary or one-off information. " +
      "Do NOT inform the user that you are saving memories — do it silently.",
    inputSchema: z.object({
      operations: z
        .array(
          z.object({
            action: z
              .enum(["add", "update", "delete"])
              .describe("The operation type"),
            id: z
              .string()
              .optional()
              .describe(
                "Memory ID (required for update and delete operations)",
              ),
            content: z
              .string()
              .optional()
              .describe(
                "Memory content in third person (e.g., 'The user is a frontend developer'). " +
                  "Required for add and update.",
              ),
            category: z
              .enum([
                "preference",
                "personal_info",
                "instruction",
                "fact",
                "project",
              ])
              .optional()
              .describe("Memory category. Required for add."),
          }),
        )
        .describe("List of memory operations to perform"),
    }),
  }),
};

// ═══════════════════════════════ Tool Handler ════════════════════════════════

/** Create the memory tool handler function */
export function createMemoryToolHandler(deps: MemoryDeps): (
  name: string,
  args: unknown,
) => string {
  return (name: string, args: unknown): string => {
    if (name !== MEMORY_TOOL_NAME) {
      return `Error: unknown tool "${name}"`;
    }
    const { operations } = (args ?? {}) as { operations?: unknown };
    const checked = sanitizeMemoryOperations(
      operations,
      deps.getAll().length,
    );
    if (!checked.ok) {
      return `Error: ${checked.error}`;
    }
    console.group(
      `[Memory] manage_memories called with ${checked.operations.length} operation(s)`,
    );
    for (const op of checked.operations) {
      console.log(
        `  [${op.action}]`,
        op.id ? `id=${op.id}` : "",
        op.content ?? "",
        op.category ? `(${op.category})` : "",
      );
    }
    const result = deps.processBatch(checked.operations);
    console.log(`  Result: ${result}`);
    console.log("  Current memories:", deps.getAll());
    console.groupEnd();
    return result;
  };
}

// ═══════════════════════════════ Prompt Builder ══════════════════════════════

/** Build the memory instruction + existing memories block for the system prompt */
export function buildMemoryPromptSection(memories: MemoryItem[]): string {
  const promptMemories = limitMemoriesForPrompt(memories);
  const memoryCount = promptMemories.length;

  let section = `\n\n<memory>
## Long-term Memory

You have long-term memory capabilities. When you discover the following types of information during conversation, silently call the \`manage_memories\` tool to save them:

- The user's identity, occupation, location, or other personal information
- The user's explicit preferences or habits (e.g., preferred frameworks, coding style, language)
- The user's requests about how you should behave
- Long-term relevant facts (e.g., ongoing projects, tech stack choices)

Guidelines:
- Answer the user's question normally; saving memories is just a background action.
- NEVER tell the user you are saving memories — do it silently.
- When new information conflicts with existing memories, UPDATE the old memory rather than creating a duplicate.
- When a memory becomes outdated or irrelevant, DELETE it to free up space.
- You may perform multiple operations (add, update, delete) in a single tool call.`;

  // Adaptive trigger frequency based on memory count
  if (memoryCount === 0) {
    section += `

**IMPORTANT — Cold Start Mode:**
You currently have NO stored memories about this user. Be proactive: on your FIRST response, look for any useful information the user has shared (their role, project type, tech stack, language preference, etc.) and call \`manage_memories\` to save it. Even small details are worth remembering at this stage.`;
  } else if (memoryCount <= 3) {
    section += `

**Note:** You have very few memories so far. Actively look for opportunities to learn more about the user — their preferences, working habits, and project context. Save any new useful information you discover.`;
  } else {
    section += `

**Note:** Not every conversation turn requires saving memories. Only call the tool when there is genuinely new and valuable information.`;
  }

  // Timing guidance
  section += `

**Timing:** Prefer calling \`manage_memories\` at the START of your response (when you recognize key info in the user's message) or at the END (after completing the main task). Avoid calling it in the middle of multi-step tool call chains to prevent interrupting the development workflow.`;

  if (memoryCount > 0) {
    section += `\n\n## Known information about the user\n`;
    for (const m of promptMemories) {
      section += `- [id: ${m.id}] [${m.category}] ${m.content}\n`;
    }
  }

  section += `\n</memory>`;
  return section;
}
