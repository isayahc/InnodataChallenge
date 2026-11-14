import { ask, type Host } from "./runtime";
import { answersSchema, type Answers, type Question } from "./schema";
import type { Evaluator } from "./evaluators";

export function compareAnswers(questions: Question[], answers: Answers) {
  if (new Set(answers.map(a => a.id)).size !== answers.length || answers.some(a => !questions.some(q => q.id === a.id))) {
    throw new Error("Verifier returned duplicate or unknown question IDs");
  }
  const checks = questions.map(q => {
    const response = answers.find(a => a.id === q.id);
    const observed = response?.answer ?? null;
    const correct = q.answer_type === "integer" ? observed === q.answer
      : typeof observed === "string" && observed.trim().toLowerCase() === q.answer;
    return { id: q.id, question: q.question, expected: q.answer, observed, correct, status: response ? "completed" : "error" };
  });
  return { passed: checks.every(c => c.correct), correct: checks.filter(c => c.correct).length, total: checks.length, checks };
}

export async function verifyImage(host: Host, image: string, questions: Question[], evaluator: Evaluator) {
  const blindQuestions = questions.map(({ id, question }) => ({ id, question }));
  const answers = await ask(host, `image-verification-${evaluator.id}`, `Use ONLY the attached image to answer these questions.
Do not infer what the designer intended. Return a JSON array of {"id":"question ID","answer":number|string|null}.
Use numeric JSON values for counts and dimensions, "yes" or "no" for connectivity, and null if unreadable.
Answer each ID exactly once. Questions: ${JSON.stringify(blindQuestions)}`, answersSchema, image, evaluator);
  return compareAnswers(questions, answers);
}
