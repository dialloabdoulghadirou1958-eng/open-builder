import type { AskUserAnswers } from "../../types/api";

export const TOOL_RESULT_LIMITS = {
  maxModelResultChars: 160_000,
} as const;

export function normalizeToolResultForModel(result: string): {
  result: string;
  truncated: boolean;
} {
  if (result.length <= TOOL_RESULT_LIMITS.maxModelResultChars) {
    return { result, truncated: false };
  }
  return {
    result:
      result.slice(0, TOOL_RESULT_LIMITS.maxModelResultChars) +
      `\n\n[tool result truncated after ${TOOL_RESULT_LIMITS.maxModelResultChars} chars]`,
    truncated: true,
  };
}

export async function toolResult<T>(
  promise: Promise<T>,
  shape: (value: T) => Record<string, unknown>,
): Promise<string> {
  try {
    return JSON.stringify({ ok: true, ...shape(await promise) });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Format the answers from `ask_user_question` into a human-readable string
 *  that the model can consume as the tool result. */
export function formatAskUserAnswers(answers: AskUserAnswers): string {
  if (!answers.answers?.length) {
    return "(no answers returned)";
  }
  return answers.answers
    .map((a, idx) => {
      const picks = a.selected.length
        ? a.selected.join(" | ")
        : "(no selection)";
      return `Q${idx + 1} [${a.header}] ${a.question}\n→ ${picks}`;
    })
    .join("\n\n");
}
