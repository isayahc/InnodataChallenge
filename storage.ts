import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Question } from "./agents/schema";

export type Validity = "unreviewed" | "valid" | "invalid";
export type JobMetrics = {
  job_id: string; started_at: string; finished_at: string | null; status: string;
  output_dir: string; text_provider: string; text_model: string; image_model: string;
  error: string | null; total: number; pending: number; errors: number;
  unreviewed: number; invalid: number; successes: number; model_failures: number; accuracy: number | null;
};
type Check = { id: string; observed: number | string | null; correct: boolean; status?: string };
type TaskRow = {
  job_id: string; task_id: string; question: string; answer_type: string;
  expected_json: string; observed_json: string | null; image: string;
  status: string; validity: Validity; matches_expected: number | null;
  review_note: string | null; error: string | null;
};

export function defaultDatabasePath() {
  return resolve(process.env.DATABASE_PATH ?? resolve(process.env.OUTPUT_DIR ?? "outputs", "history.sqlite"));
}

export class History {
  readonly db: Database;
  constructor(path = defaultDatabasePath()) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','completed','error')),
        output_dir TEXT NOT NULL, text_provider TEXT NOT NULL, text_model TEXT NOT NULL,
        image_model TEXT NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS tasks (
        job_id TEXT NOT NULL REFERENCES jobs(job_id), task_id TEXT NOT NULL,
        question TEXT NOT NULL, answer_type TEXT NOT NULL, expected_json TEXT NOT NULL,
        observed_json TEXT, image TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','error')),
        validity TEXT NOT NULL DEFAULT 'unreviewed' CHECK(validity IN ('unreviewed','valid','invalid')),
        matches_expected INTEGER CHECK(matches_expected IN (0,1)),
        review_note TEXT, error TEXT, PRIMARY KEY(job_id, task_id)
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, task_id TEXT NOT NULL,
        reviewed_at TEXT NOT NULL, validity TEXT NOT NULL, note TEXT NOT NULL,
        FOREIGN KEY(job_id, task_id) REFERENCES tasks(job_id, task_id)
      );
      CREATE TABLE IF NOT EXISTS job_models (
        job_id TEXT NOT NULL REFERENCES jobs(job_id), stage TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY(job_id,stage)
      );
      CREATE VIEW IF NOT EXISTS job_metrics AS
      SELECT j.*,
        COUNT(t.task_id) AS total,
        COALESCE(SUM(t.status = 'pending'),0) AS pending,
        COALESCE(SUM(t.status = 'error'),0) AS errors,
        COALESCE(SUM(t.validity = 'unreviewed'),0) AS unreviewed,
        COALESCE(SUM(t.validity = 'invalid'),0) AS invalid,
        COALESCE(SUM(t.validity = 'valid' AND t.status = 'completed' AND t.matches_expected = 1),0) AS successes,
        COALESCE(SUM(t.validity = 'valid' AND t.status = 'completed' AND t.matches_expected = 0),0) AS model_failures,
        1.0 * SUM(t.validity = 'valid' AND t.status = 'completed' AND t.matches_expected = 1)
          / NULLIF(SUM(t.validity = 'valid' AND t.status = 'completed'),0) AS accuracy
      FROM jobs j LEFT JOIN tasks t ON j.job_id = t.job_id GROUP BY j.job_id;
    `);
  }

  start(job: { id: string; output: string; provider: string; model: string; imageModel: string }) {
    this.db.transaction(() => {
    this.db.query("INSERT INTO jobs(job_id,started_at,status,output_dir,text_provider,text_model,image_model) VALUES (?,?, 'running',?,?,?,?)")
      .run(job.id, new Date().toISOString(), job.output, job.provider, job.model, job.imageModel);
      for (const stage of ["floorplan", "image", "questions", "evaluation"]) {
        this.db.query("INSERT INTO job_models(job_id,stage,provider,model) VALUES (?,?,?,?)")
          .run(job.id, stage, stage === "image" ? "openrouter" : job.provider, stage === "image" ? job.imageModel : job.model);
      }
    })();
  }

  addTasks(jobId: string, image: string, questions: Question[]) {
    this.db.transaction(() => {
      for (const q of questions) this.db.query("INSERT INTO tasks(job_id,task_id,question,answer_type,expected_json,image) VALUES (?,?,?,?,?,?)")
        .run(jobId, q.id, q.question, q.answer_type, JSON.stringify(q.answer), image);
    })();
  }

  recordAnswers(jobId: string, checks: Check[]) {
    this.db.transaction(() => {
      for (const check of checks) {
        const missing = check.status === "error";
        const result = this.db.query("UPDATE tasks SET observed_json=?,matches_expected=?,status=?,error=? WHERE job_id=? AND task_id=?")
          .run(JSON.stringify(check.observed), missing ? null : Number(check.correct), missing ? "error" : "completed",
            missing ? "Model omitted this question" : null, jobId, check.id);
        if (!result.changes) throw new Error(`Unknown task: ${check.id}`);
      }
    })();
  }

  finish(jobId: string, error?: string) {
    this.db.transaction(() => {
      if (error) this.db.query("UPDATE tasks SET status='error',error=? WHERE job_id=? AND status='pending'").run(error, jobId);
      this.db.query("UPDATE jobs SET status=?,finished_at=?,error=? WHERE job_id=?")
        .run(error ? "error" : "completed", new Date().toISOString(), error ?? null, jobId);
    })();
  }

  review(jobId: string, taskId: string, validity: Validity, note: string) {
    if (!["valid", "invalid", "unreviewed"].includes(validity)) throw new Error("Invalid review status");
    if (!note.trim()) throw new Error("A review note is required");
    this.db.transaction(() => {
      const result = this.db.query("UPDATE tasks SET validity=?,review_note=? WHERE job_id=? AND task_id=?").run(validity, note, jobId, taskId);
      if (!result.changes) throw new Error("Job/task not found");
      this.db.query("INSERT INTO reviews(job_id,task_id,reviewed_at,validity,note) VALUES (?,?,?,?,?)")
        .run(jobId, taskId, new Date().toISOString(), validity, note);
    })();
  }

  metrics(jobId: string): JobMetrics | null;
  metrics(): JobMetrics[];
  metrics(jobId?: string): JobMetrics | JobMetrics[] | null {
    return jobId ? this.db.query<JobMetrics, [string]>("SELECT * FROM job_metrics WHERE job_id=?").get(jobId)
      : this.db.query<JobMetrics, []>("SELECT * FROM job_metrics ORDER BY started_at DESC,job_id").all();
  }

  cumulative() {
    const jobs = this.metrics();
    const sum = (key: "total" | "successes" | "model_failures" | "errors" | "unreviewed" | "invalid" | "pending") => jobs.reduce((n, j) => n + j[key], 0);
    const successes = sum("successes"), failures = sum("model_failures");
    return { jobs: jobs.length, tasks: sum("total"), successes, failures, errors: sum("errors"),
      jobErrors: jobs.filter(j => j.status === "error").length, unreviewed: sum("unreviewed"), invalid: sum("invalid"), pending: sum("pending"),
      accuracy: successes + failures ? successes / (successes + failures) : null };
  }

  job(jobId: string) {
    const metrics = this.metrics(jobId);
    if (!metrics) throw new Error("Job not found");
    const rows = this.db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE job_id=? ORDER BY rowid").all(jobId);
    const savedModels = this.db.query<{ stage: string; provider: string; model: string }, [string]>("SELECT stage,provider,model FROM job_models WHERE job_id=?").all(jobId);
    const models = savedModels.length ? savedModels : ["floorplan", "image", "questions", "evaluation"].map(stage => ({
      stage, provider: stage === "image" ? "openrouter" : metrics.text_provider,
      model: stage === "image" ? metrics.image_model : metrics.text_model,
    }));
    return { jobId, metrics, models, tasks: rows.map(t => {
      const scored = t.validity === "valid" && t.status === "completed";
      return { jobId, taskId: t.task_id, image: t.image, question: t.question, answerType: t.answer_type,
        expectedAnswer: JSON.parse(t.expected_json), modelAnswer: t.observed_json === null ? null : JSON.parse(t.observed_json),
        status: t.status, validity: t.validity, reviewNote: t.review_note,
        matchesExpected: t.matches_expected === null ? null : Boolean(t.matches_expected),
        failed: scored ? t.matches_expected === 0 : null,
        outcome: t.status === "error" ? "error" : scored ? (t.matches_expected ? "success" : "model_failure") : "excluded",
        error: t.error };
    }) };
  }

  close() { this.db.close(); }
}
