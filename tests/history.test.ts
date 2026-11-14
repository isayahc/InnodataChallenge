import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { History } from "../storage";

const questions = [
  { id: "count", question: "How many rooms?", answer: 4, answer_type: "integer" as const },
  { id: "door", question: "Is there a door?", answer: "yes", answer_type: "label" as const },
];
function start(history: History, id = "job-1") {
  history.start({ id, output: "outputs/test", provider: "test", model: "test-model", imageModel: "test-image" });
  history.addTasks(id, "floorplan.png", questions);
}

test("persists results and scores only completed tasks reviewed as valid", () => {
  const directory = mkdtempSync(join(tmpdir(), "innodata-history-"));
  const path = join(directory, "history.sqlite");
  let history = new History(path);
  try {
    start(history);
    history.recordAnswers("job-1", [
      { id: "count", observed: 4, correct: true },
      { id: "door", observed: "no", correct: false },
    ]);
    history.finish("job-1");
    expect(history.metrics("job-1")).toMatchObject({ unreviewed: 2, successes: 0, model_failures: 0, accuracy: null });
    expect(history.job("job-1").tasks.map(t => t.failed)).toEqual([null, null]);
    history.close();
    history = new History(path);
    expect(history.job("job-1").tasks[1]!.modelAnswer).toBe("no");
    history.review("job-1", "count", "valid", "Four rooms clearly visible");
    history.review("job-1", "door", "valid", "Door clearly visible");
    expect(history.metrics("job-1")).toMatchObject({ successes: 1, model_failures: 1, accuracy: 0.5 });
    expect(history.job("job-1").tasks.map(t => t.failed)).toEqual([false, true]);
    history.review("job-1", "door", "invalid", "Correction: image does not depict intended door");
    expect(history.metrics("job-1")).toMatchObject({ invalid: 1, successes: 1, model_failures: 0, accuracy: 1 });
    expect(history.db.query("SELECT COUNT(*) AS count FROM reviews").get()).toEqual({ count: 3 });
    history.review("job-1", "count", "unreviewed", "Needs another review");
    expect(history.metrics("job-1")).toMatchObject({ accuracy: null });
  } finally { history.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("API errors and missing answers are excluded, even on valid tasks", () => {
  const history = new History(":memory:");
  try {
    start(history);
    history.review("job-1", "count", "valid", "Confirmed count");
    history.finish("job-1", "API unavailable");
    expect(history.metrics("job-1")).toMatchObject({ status: "error", errors: 2, model_failures: 0, accuracy: null });
    expect(history.job("job-1").tasks[0]).toMatchObject({ outcome: "error", failed: null });
    start(history, "job-2");
    history.review("job-2", "count", "valid", "Confirmed count");
    history.recordAnswers("job-2", [{ id: "count", observed: null, correct: false, status: "error" }]);
    expect(history.metrics("job-2")).toMatchObject({ errors: 1, pending: 1, model_failures: 0, accuracy: null });
    expect((history.metrics() as unknown[]).length).toBe(2);
    expect(() => history.review("job-2", "unknown", "valid", "review")).toThrow();
  } finally { history.close(); }
});

test("early job errors remain visible without tasks", () => {
  const history = new History(":memory:");
  try {
    history.start({ id: "early", output: "outputs/test", provider: "test", model: "test", imageModel: "test" });
    history.finish("early", "Missing API key");
    expect(history.metrics("early")).toMatchObject({ status: "error", total: 0, accuracy: null });
  } finally { history.close(); }
});
