import { answersSchema, type Answers } from "./types";
import type { Question } from "../validate/schema";
import type { Evaluator } from "./evaluators";
import { parseOutput } from "./structured-output";

export const TEMPERATURE = 0;
export const MAX_TOKENS = 4096;
export const PROMPT = `Use ONLY the attached floorplan image to answer the questions. Do not infer what the designer intended.
Return ONLY a JSON array of {"id":"question ID","answer":number|string|null}.
Use numeric JSON values for counts and dimensions, "yes" or "no" for connectivity, and null if unreadable.
Answer each ID exactly once. Do not include markdown or explanations.`;

export class EvaluationError extends Error {
  constructor(message: string, readonly raw: unknown, readonly finishReason = "error") { super(message); }
}

export function extractAnswers(text: string): Answers {
  try { return parseOutput(text, answersSchema); } catch (original) {
    // Some providers prepend prose despite the JSON-only instruction. Accept only
    // a complete trailing array that passes the same schema; never infer answers.
    for (let i = text.indexOf("["); i >= 0; i = text.indexOf("[", i + 1)) {
      try { return parseOutput(text.slice(i).trim(), answersSchema); } catch { /* next candidate */ }
    }
    throw original;
  }
}

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

export async function verifyImage(image: string, questions: Question[], evaluator: Evaluator) {
  const blindQuestions = questions.map(({ id, question }) => ({ id, question }));
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: evaluator.model, temperature: TEMPERATURE, max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: [{ type: "text", text: `${PROMPT}\nQuestions: ${JSON.stringify(blindQuestions)}` },
        { type: "image_url", image_url: { url: image } }] }] }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.json();
  const choice = raw.choices?.[0];
  const finishReason = choice?.finish_reason ?? "error";
  if (!response.ok || raw.error || !choice) throw new EvaluationError(`OpenRouter request failed (${response.status})`, raw, finishReason);
  if (finishReason !== "stop") throw new EvaluationError(`Incomplete response: ${finishReason}`, raw, finishReason);
  const text = choice.message?.content;
  if (typeof text !== "string") throw new EvaluationError("No text response", raw, finishReason);
  try {
    const answers = extractAnswers(text);
    if (answers.length !== questions.length) throw new Error("Missing answers");
    return { ...compareAnswers(questions, answers), raw, text, finishReason, answers };
  } catch (error) { throw new EvaluationError(error instanceof Error ? error.message : String(error), raw, finishReason); }
}
