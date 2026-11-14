import type { Evaluator } from "./evaluators";
import type { History } from "../storage";
import type { verifyImage } from "./verify";

export async function evaluateAll(history: History, jobId: string, evaluators: Evaluator[],
  run: (evaluator: Evaluator) => ReturnType<typeof verifyImage>) {
  return Promise.all(evaluators.map(async evaluator => {
    try {
      const result = await run(evaluator);
      history.recordAnswers(jobId, result.checks, evaluator.id);
      history.finishEvaluation(jobId, evaluator.id);
      return { evaluator, status: "completed" as const, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      history.finishEvaluation(jobId, evaluator.id, message);
      return { evaluator, status: "error" as const, error: message };
    }
  }));
}
