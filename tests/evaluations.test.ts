import { test, expect } from "bun:test";
import { History } from "../storage";
import { EVALUATORS } from "../agents/evaluators";
import { evaluateAll } from "../agents/evaluate-all";
import { compareAnswers } from "../agents/verify";

const questions = [{ id: "rooms", question: "How many rooms?", answer: 4, answer_type: "integer" as const }];
function fixture() {
  const h = new History(":memory:");
  h.start({ id: "dual", output: "outputs/test", provider: "anthropic", model: "generator", imageModel: "image", evaluators: EVALUATORS });
  h.addTasks("dual", "floorplan.jpg", questions);
  return h;
}

test("both evaluators run, store independent answers, and share one task validity", async () => {
  const h = fixture();
  try {
    const called: string[] = [];
    const results = await evaluateAll(h, "dual", EVALUATORS, async evaluator => {
      called.push(evaluator.model);
      return compareAnswers(questions, [{ id: "rooms", answer: evaluator.id === "opus" ? 4 : 5 }]);
    });
    expect(called).toEqual(["anthropic/claude-opus-5.5", "openai/gpt-6-luna"]);
    expect(results.map(r => r.status)).toEqual(["completed", "completed"]);
    expect(h.job("dual").tasks[0]!.answers.map(a => a.modelAnswer)).toEqual([4, 5]);
    expect(h.metrics("dual")).toMatchObject({ total: 1, unreviewed: 1, successes: 0, model_failures: 0 });
    h.review("dual", "rooms", "valid", "Four rooms visible");
    expect(h.job("dual").tasks[0]!.answers.map(a => a.failed)).toEqual([false, true]);
    expect(h.modelMetrics("dual")).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "anthropic/claude-opus-5.5", successes: 1, failures: 0, accuracy: 1 }),
      expect.objectContaining({ model: "openai/gpt-6-luna", successes: 0, failures: 1, accuracy: 0 }),
    ]));
    h.review("dual", "rooms", "invalid", "Image contradicts intended JSON");
    expect(h.job("dual").tasks[0]!.answers.map(a => a.failed)).toEqual([null, null]);
    expect(h.metrics("dual")).toMatchObject({ total: 1, invalid: 1, successes: 0, model_failures: 0, accuracy: null });
  } finally { h.close(); }
});

test("one model's API error does not prevent or erase the other evaluation", async () => {
  const h = fixture();
  try {
    await evaluateAll(h, "dual", EVALUATORS, async evaluator => {
      if (evaluator.id === "opus") throw new Error("Provider unavailable");
      return compareAnswers(questions, [{ id: "rooms", answer: 4 }]);
    });
    h.finish("dual", "One evaluator failed");
    h.review("dual", "rooms", "valid", "Confirmed");
    const answers = h.job("dual").tasks[0]!.answers;
    expect(answers[0]).toMatchObject({ status: "error", failed: null, error: "Provider unavailable" });
    expect(answers[1]).toMatchObject({ status: "completed", modelAnswer: 4, failed: false });
    expect(h.metrics("dual")).toMatchObject({ total: 1, errors: 1, successes: 1, model_failures: 0 });
  } finally { h.close(); }
});
