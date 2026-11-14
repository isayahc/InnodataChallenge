export type ResponseRow = {
  model: string; task_id: string; status: "ok" | "api_error"; parsed: boolean;
  question_type: string; response: string; ref_answer: string | number;
  correct: 0 | 1; finish_reason: string; error: "" | "api_error" | "length";
};

export function summarize(rows: ResponseRow[]) {
  return [...new Set(rows.map(r => r.model))].map(model => {
    const responses = rows.filter(r => r.model === model), complete = responses.filter(r => r.status === "ok" && r.parsed);
    const correct = complete.filter(r => r.correct === 1).length;
    return { model, tasks: responses.length, completed: complete.length, errors: responses.length - complete.length,
      correct, incorrect: complete.length - correct, accuracy: complete.length ? correct / complete.length : null };
  });
}
