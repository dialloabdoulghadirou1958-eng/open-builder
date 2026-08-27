import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInteractiveStore } from "./interactive";

const questions = [
  {
    header: "Runtime",
    question: "Choose a runtime?",
    multiSelect: false,
    options: [
      { label: "Browser", description: "Run in the browser." },
      { label: "Desktop", description: "Run on the desktop." },
    ],
  },
];

describe("interactive question store", () => {
  beforeEach(() => {
    useInteractiveStore.setState({ pending: [] });
  });

  it("defaults AI questions to questionnaire presentation", () => {
    void useInteractiveStore.getState().askQuestion({
      toolCallId: "question-1",
      questions,
    });

    expect(useInteractiveStore.getState().pending[0]).toMatchObject({
      kind: "question",
      toolCallId: "question-1",
      presentation: "questionnaire",
    });
  });

  it("keeps an explicit approval presentation", () => {
    void useInteractiveStore.getState().askQuestion({
      toolCallId: "approval-1",
      questions,
      presentation: "approval",
    });

    expect(useInteractiveStore.getState().pending[0]).toMatchObject({
      presentation: "approval",
    });
  });

  it("resolves a question once even when resolution is requested twice", async () => {
    const answerPromise = useInteractiveStore.getState().askQuestion({
      toolCallId: "question-1",
      questions,
    });
    const pending = useInteractiveStore.getState().pending[0];
    if (pending.kind !== "question") throw new Error("Expected question");
    const originalResolve = pending.resolve;
    const resolveSpy = vi.fn(originalResolve);
    pending.resolve = resolveSpy;
    const answers = {
      answers: [
        {
          header: "Runtime",
          question: "Choose a runtime?",
          selected: ["Browser"],
        },
      ],
    };

    useInteractiveStore.getState().resolveQuestion("question-1", answers);
    useInteractiveStore.getState().resolveQuestion("question-1", answers);

    await expect(answerPromise).resolves.toEqual(answers);
    expect(resolveSpy).toHaveBeenCalledOnce();
    expect(useInteractiveStore.getState().pending).toEqual([]);
  });

  it("rejects a pending questionnaire when generation is cancelled", async () => {
    const answerPromise = useInteractiveStore.getState().askQuestion({
      toolCallId: "question-cancelled",
      questions,
    });

    useInteractiveStore.getState().rejectAllPending("user stopped");

    await expect(answerPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(useInteractiveStore.getState().pending).toEqual([]);
  });
});
