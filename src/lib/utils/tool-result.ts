import type { AskUserAnswers } from "../../types/api";

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
