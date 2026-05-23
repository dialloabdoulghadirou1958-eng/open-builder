import { create } from "zustand";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AskUserQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
}

export interface AskUserAnswerItem {
  question: string;
  header: string;
  selected: string[];
}

export interface AskUserAnswers {
  answers: AskUserAnswerItem[];
}

export type PlanDecision =
  | { approved: true }
  | { approved: false; feedback?: string };

interface PendingQuestion {
  kind: "question";
  toolCallId: string;
  questions: AskUserQuestion[];
  resolve: (answer: AskUserAnswers) => void;
  reject: (err: Error) => void;
}

interface PendingPlan {
  kind: "plan";
  toolCallId: string;
  plan: string;
  resolve: (decision: PlanDecision) => void;
  reject: (err: Error) => void;
}

type PendingItem = PendingQuestion | PendingPlan;

interface InteractiveState {
  pending: PendingItem[];

  askQuestion: (input: {
    toolCallId: string;
    questions: AskUserQuestion[];
  }) => Promise<AskUserAnswers>;

  askPlanApproval: (input: {
    toolCallId: string;
    plan: string;
  }) => Promise<PlanDecision>;

  resolveQuestion: (toolCallId: string, answers: AskUserAnswers) => void;
  resolvePlan: (toolCallId: string, decision: PlanDecision) => void;
  rejectAllPending: (reason: string) => void;

  getPending: (toolCallId: string) => PendingItem | undefined;
}

export const useInteractiveStore = create<InteractiveState>((set, get) => ({
  pending: [],

  askQuestion: ({ toolCallId, questions }) =>
    new Promise<AskUserAnswers>((resolve, reject) => {
      set((state) => ({
        pending: [
          ...state.pending,
          { kind: "question", toolCallId, questions, resolve, reject },
        ],
      }));
    }),

  askPlanApproval: ({ toolCallId, plan }) =>
    new Promise<PlanDecision>((resolve, reject) => {
      set((state) => ({
        pending: [
          ...state.pending,
          { kind: "plan", toolCallId, plan, resolve, reject },
        ],
      }));
    }),

  resolveQuestion: (toolCallId, answers) => {
    const item = get().pending.find(
      (p): p is PendingQuestion =>
        p.kind === "question" && p.toolCallId === toolCallId,
    );
    if (!item) return;
    item.resolve(answers);
    set((state) => ({
      pending: state.pending.filter((p) => p.toolCallId !== toolCallId),
    }));
  },

  resolvePlan: (toolCallId, decision) => {
    const item = get().pending.find(
      (p): p is PendingPlan =>
        p.kind === "plan" && p.toolCallId === toolCallId,
    );
    if (!item) return;
    item.resolve(decision);
    set((state) => ({
      pending: state.pending.filter((p) => p.toolCallId !== toolCallId),
    }));
  },

  rejectAllPending: (reason) => {
    const items = get().pending;
    if (items.length === 0) return;
    for (const item of items) {
      try {
        item.reject(new DOMException(reason, "AbortError"));
      } catch {
        /* ignore */
      }
    }
    set({ pending: [] });
  },

  getPending: (toolCallId) =>
    get().pending.find((p) => p.toolCallId === toolCallId),
}));
