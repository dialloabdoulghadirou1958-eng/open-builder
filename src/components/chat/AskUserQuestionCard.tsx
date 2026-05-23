import { useMemo, useState } from "react";
import { HelpCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../i18n";
import {
  useInteractiveStore,
  type AskUserQuestion,
  type AskUserAnswers,
} from "../../store/interactive";

interface AskUserQuestionCardProps {
  toolCallId: string;
  /** Questions parsed from the tool call's rawArgs. May be an empty array while
   *  pending (the AI SDK has not yet written args back into the message); in that
   *  case we fall back to the pending entry's `questions`. */
  questions: AskUserQuestion[];
  /** Tool result string from the AI loop. Empty while pending; formatted answers
   *  once the user has submitted. */
  result: string;
}

/**
 * Per-question UI state. For single-select we hold a single label (or "" for nothing).
 * For multi-select we hold a Set of labels. The "Other" branch lets the user type
 * a free-text answer; when set, it overrides label selection.
 */
interface QuestionState {
  selected: Set<string>;
  otherActive: boolean;
  otherText: string;
}

const EMPTY_QUESTION_STATE: QuestionState = {
  selected: new Set<string>(),
  otherActive: false,
  otherText: "",
};

function isQuestionAnswered(state: QuestionState): boolean {
  if (state.otherActive) return state.otherText.trim().length > 0;
  return state.selected.size > 0;
}

function collectAnswers(
  questions: AskUserQuestion[],
  states: QuestionState[],
): AskUserAnswers {
  return {
    answers: questions.map((q, i) => {
      const s = states[i];
      const selected = s.otherActive
        ? [s.otherText.trim()]
        : Array.from(s.selected);
      return {
        question: q.question,
        header: q.header,
        selected,
      };
    }),
  };
}

export function AskUserQuestionCard({
  toolCallId,
  questions,
  result,
}: AskUserQuestionCardProps) {
  const t = useT();
  const pending = useInteractiveStore((s) =>
    s.pending.find(
      (p) => p.toolCallId === toolCallId && p.kind === "question",
    ),
  );

  const effectiveQuestions =
    pending && pending.kind === "question" ? pending.questions : questions;

  // Sparse override map: only indexes the user has touched are present.
  // Indexes not in the map fall back to EMPTY_QUESTION_STATE. This avoids
  // mirroring effectiveQuestions into state, which would need a render-phase
  // resync when `pending` arrives after the card mounts.
  const [overrides, setOverrides] = useState<Record<number, QuestionState>>(
    {},
  );

  const states = useMemo(
    () =>
      effectiveQuestions.map(
        (_, i) => overrides[i] ?? EMPTY_QUESTION_STATE,
      ),
    [effectiveQuestions, overrides],
  );

  const allAnswered = useMemo(
    () =>
      effectiveQuestions.length > 0 && states.every(isQuestionAnswered),
    [states, effectiveQuestions.length],
  );

  const updateQuestion = (idx: number, patch: Partial<QuestionState>) => {
    setOverrides((prev) => ({
      ...prev,
      [idx]: { ...(prev[idx] ?? EMPTY_QUESTION_STATE), ...patch },
    }));
  };

  const toggleOption = (idx: number, label: string, multi: boolean) => {
    setOverrides((prev) => {
      const cur = prev[idx] ?? EMPTY_QUESTION_STATE;
      const selected = new Set(cur.selected);
      if (multi) {
        if (selected.has(label)) selected.delete(label);
        else selected.add(label);
      } else {
        selected.clear();
        selected.add(label);
      }
      return {
        ...prev,
        [idx]: { ...cur, selected, otherActive: false, otherText: "" },
      };
    });
  };

  const submit = () => {
    if (!allAnswered) return;
    useInteractiveStore
      .getState()
      .resolveQuestion(
        toolCallId,
        collectAnswers(effectiveQuestions, states),
      );
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <HelpCircle className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t.chat.askQuestion.title}</span>
        {!pending && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="w-3.5 h-3.5" />
            {t.chat.askQuestion.answered}
          </span>
        )}
      </div>
      <div className="px-3 py-2 space-y-3">
        {effectiveQuestions.map((q, i) => (
          <QuestionRow
            key={i}
            index={i}
            question={q}
            state={states[i]}
            pending={!!pending}
            result={result}
            onToggle={(label) => toggleOption(i, label, q.multiSelect)}
            onOther={(active) =>
              updateQuestion(i, {
                otherActive: active,
                selected: active ? new Set() : states[i].selected,
              })
            }
            onOtherText={(otherText) => updateQuestion(i, { otherText })}
            t={t}
          />
        ))}
      </div>
      {pending && (
        <div className="px-3 py-2 border-t border-border bg-muted/20 flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!allAnswered}
            onClick={submit}
          >
            {t.chat.askQuestion.submit}
          </Button>
        </div>
      )}
    </div>
  );
}

interface QuestionRowProps {
  index: number;
  question: AskUserQuestion;
  state: QuestionState;
  pending: boolean;
  result: string;
  onToggle: (label: string) => void;
  onOther: (active: boolean) => void;
  onOtherText: (text: string) => void;
  t: ReturnType<typeof useT>;
}

function QuestionRow({
  index,
  question,
  state,
  pending,
  onToggle,
  onOther,
  onOtherText,
  t,
}: QuestionRowProps) {
  const hint = question.multiSelect
    ? t.chat.askQuestion.multiSelectHint
    : t.chat.askQuestion.singleSelectHint;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs font-mono text-muted-foreground">
          Q{index + 1}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {question.header}
        </span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <p className="text-sm mb-2">{question.question}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {question.options.map((opt) => {
          const active = state.selected.has(opt.label) && !state.otherActive;
          return (
            <button
              key={opt.label}
              type="button"
              disabled={!pending}
              onClick={() => onToggle(opt.label)}
              className={`text-left px-3 py-2 rounded-md border text-xs transition-colors ${
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:bg-accent/50"
              } ${pending ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-muted-foreground mt-0.5">
                {opt.description}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        {!state.otherActive ? (
          <button
            type="button"
            disabled={!pending}
            onClick={() => onOther(true)}
            className={`text-xs text-muted-foreground hover:text-foreground transition-colors ${
              pending ? "cursor-pointer" : "cursor-default"
            }`}
          >
            {t.chat.askQuestion.other}
          </button>
        ) : (
          <div className="flex gap-2 items-start">
            <Textarea
              value={state.otherText}
              onChange={(e) => onOtherText(e.target.value)}
              placeholder={t.chat.askQuestion.otherPlaceholder}
              rows={2}
              className="text-sm resize-none flex-1"
              autoFocus
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOther(false)}
            >
              <span className="text-xs">×</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
