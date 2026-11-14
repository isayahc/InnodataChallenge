import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Question } from "./agents/schema";
import type { Evaluator } from "./agents/evaluators";
import { floorplanSchema, type Floorplan } from "./agents/schema";
import { layoutFingerprint } from "./agents/diversity";

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
      CREATE TABLE IF NOT EXISTS generated_plans (
        job_id TEXT PRIMARY KEY REFERENCES jobs(job_id), fingerprint TEXT NOT NULL UNIQUE,
        plan_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluations (
        job_id TEXT NOT NULL REFERENCES jobs(job_id), evaluator_id TEXT NOT NULL,
        name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', error TEXT,
        PRIMARY KEY(job_id,evaluator_id)
      );
      CREATE TABLE IF NOT EXISTS evaluation_answers (
        job_id TEXT NOT NULL, evaluator_id TEXT NOT NULL, task_id TEXT NOT NULL,
        observed_json TEXT, matches_expected INTEGER, status TEXT NOT NULL DEFAULT 'pending', error TEXT,
        PRIMARY KEY(job_id,evaluator_id,task_id),
        FOREIGN KEY(job_id,evaluator_id) REFERENCES evaluations(job_id,evaluator_id),
        FOREIGN KEY(job_id,task_id) REFERENCES tasks(job_id,task_id)
      );
      CREATE VIEW IF NOT EXISTS answer_rows AS
        SELECT a.*,e.name,e.provider,e.model,t.validity FROM evaluation_answers a
        JOIN evaluations e USING(job_id,evaluator_id) JOIN tasks t USING(job_id,task_id)
        UNION ALL
        SELECT t.job_id,'legacy',t.task_id,t.observed_json,t.matches_expected,t.status,t.error,
          j.text_model,j.text_provider,j.text_model,t.validity FROM tasks t JOIN jobs j USING(job_id)
        WHERE NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.job_id=t.job_id);
      DROP VIEW IF EXISTS job_metrics;
      CREATE VIEW job_metrics AS
      SELECT j.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.job_id=j.job_id) AS total,
        (SELECT COUNT(*) FROM tasks t WHERE t.job_id=j.job_id AND t.validity='unreviewed') AS unreviewed,
        (SELECT COUNT(*) FROM tasks t WHERE t.job_id=j.job_id AND t.validity='invalid') AS invalid,
        COALESCE(SUM(a.status='pending'),0) AS pending,
        COALESCE(SUM(a.status='error'),0) AS errors,
        COALESCE(SUM(a.validity='valid' AND a.status='completed' AND a.matches_expected=1),0) AS successes,
        COALESCE(SUM(a.validity='valid' AND a.status='completed' AND a.matches_expected=0),0) AS model_failures,
        1.0 * SUM(a.validity='valid' AND a.status='completed' AND a.matches_expected=1)
          / NULLIF(SUM(a.validity='valid' AND a.status='completed'),0) AS accuracy
      FROM jobs j LEFT JOIN answer_rows a ON j.job_id=a.job_id GROUP BY j.job_id;
    `);
  }

  reservePlan(jobId: string, input: Floorplan) {
    const plan = floorplanSchema.parse(input);
    // The unique fingerprint constraint also prevents concurrent jobs reserving duplicates.
    return this.db.query(`INSERT INTO generated_plans(job_id,fingerprint,plan_json,created_at) VALUES (?,?,?,?)
      ON CONFLICT(fingerprint) DO NOTHING`).run(jobId, layoutFingerprint(plan), JSON.stringify(plan), new Date().toISOString()).changes > 0;
  }

  generationContext(limit = 12) {
    const recent = this.db.query<{ job_id: string; plan_json: string; status: string }, [number]>(`
      SELECT p.job_id,p.plan_json,j.status FROM generated_plans p JOIN jobs j USING(job_id)
      ORDER BY p.created_at DESC,p.job_id LIMIT ?`).all(limit);
    return { totalPastLayouts: (this.db.query("SELECT COUNT(*) AS count FROM generated_plans").get() as { count: number }).count,
      recentJobs: recent.map(job => ({ jobId: job.job_id, status: job.status,
        floorplan: JSON.parse(job.plan_json),
        questionCategories: this.db.query(`SELECT
          CASE WHEN task_id IN ('room_count','door_count') THEN 'count'
            WHEN task_id LIKE '%_width' OR task_id LIKE '%_height' THEN 'dimensions'
            ELSE 'door_connectivity' END AS category,COUNT(*) AS count
          FROM tasks WHERE job_id=? GROUP BY category`).all(job.job_id),
        reviewedPerformance: this.modelMetrics(job.job_id),
      })) };
  }

  start(job: { id: string; output: string; provider: string; model: string; imageModel: string; imageProvider?: string; evaluators?: Evaluator[] }) {
    this.db.transaction(() => {
    this.db.query("INSERT INTO jobs(job_id,started_at,status,output_dir,text_provider,text_model,image_model) VALUES (?,?, 'running',?,?,?,?)")
      .run(job.id, new Date().toISOString(), job.output, job.provider, job.model, job.imageModel);
       for (const stage of ["floorplan", "image", "questions", ...(job.evaluators ? [] : ["evaluation"])]) {
        this.db.query("INSERT INTO job_models(job_id,stage,provider,model) VALUES (?,?,?,?)")
           .run(job.id, stage, stage === "image" ? job.imageProvider ?? "openrouter" : job.provider, stage === "image" ? job.imageModel : job.model);
       }
       for (const evaluator of job.evaluators ?? []) {
         this.db.query("INSERT INTO evaluations(job_id,evaluator_id,name,provider,model) VALUES (?,?,?,?,?)")
           .run(job.id, evaluator.id, evaluator.name, evaluator.provider, evaluator.model);
         this.db.query("INSERT INTO job_models(job_id,stage,provider,model) VALUES (?,?,?,?)")
           .run(job.id, `evaluation:${evaluator.id}`, evaluator.provider, evaluator.model);
       }
    })();
  }

  addTasks(jobId: string, image: string, questions: Question[]) {
    this.db.transaction(() => {
      for (const q of questions) this.db.query("INSERT INTO tasks(job_id,task_id,question,answer_type,expected_json,image) VALUES (?,?,?,?,?,?)")
        .run(jobId, q.id, q.question, q.answer_type, JSON.stringify(q.answer), image);
      this.db.query(`INSERT INTO evaluation_answers(job_id,evaluator_id,task_id)
        SELECT t.job_id,e.evaluator_id,t.task_id FROM tasks t JOIN evaluations e USING(job_id) WHERE t.job_id=?`).run(jobId);
    })();
  }

  recordAnswers(jobId: string, checks: Check[], evaluatorId?: string) {
    this.db.transaction(() => {
      for (const check of checks) {
        const missing = check.status === "error";
        const result = evaluatorId ? this.db.query("UPDATE evaluation_answers SET observed_json=?,matches_expected=?,status=?,error=? WHERE job_id=? AND task_id=? AND evaluator_id=?")
          .run(JSON.stringify(check.observed), missing ? null : Number(check.correct), missing ? "error" : "completed",
            missing ? "Model omitted this question" : null, jobId, check.id, evaluatorId)
          : this.db.query("UPDATE tasks SET observed_json=?,matches_expected=?,status=?,error=? WHERE job_id=? AND task_id=?")
          .run(JSON.stringify(check.observed), missing ? null : Number(check.correct), missing ? "error" : "completed",
            missing ? "Model omitted this question" : null, jobId, check.id);
        if (!result.changes) throw new Error(`Unknown task: ${check.id}`);
      }
    })();
  }

  finishEvaluation(jobId: string, evaluatorId: string, error?: string) {
    this.db.transaction(() => {
      this.db.query("UPDATE evaluation_answers SET status='error',error=? WHERE job_id=? AND evaluator_id=? AND status='pending'")
        .run(error ?? "Model omitted this question", jobId, evaluatorId);
      this.db.query("UPDATE evaluations SET status=?,error=? WHERE job_id=? AND evaluator_id=?")
        .run(error ? "error" : "completed", error ?? null, jobId, evaluatorId);
    })();
  }

  modelMetrics(jobId?: string) {
    return this.db.query(`SELECT provider,model,MAX(name) AS name,COUNT(*) AS responses,
      SUM(status='completed') AS evaluated,SUM(status='error') AS errors,SUM(status='pending') AS pending,
      SUM(validity='valid' AND status='completed' AND matches_expected=1) AS successes,
      SUM(validity='valid' AND status='completed' AND matches_expected=0) AS failures,
      1.0 * SUM(validity='valid' AND status='completed' AND matches_expected=1)
        / NULLIF(SUM(validity='valid' AND status='completed'),0) AS accuracy
      FROM answer_rows ${jobId ? "WHERE job_id=?" : ""} GROUP BY provider,model ORDER BY model`).all(...(jobId ? [jobId] : []));
  }

  finish(jobId: string, error?: string) {
    this.db.transaction(() => {
      if (error) this.db.query("UPDATE tasks SET status='error',error=? WHERE job_id=? AND status='pending'").run(error, jobId);
      if (error) {
        this.db.query("UPDATE evaluation_answers SET status='error',error=? WHERE job_id=? AND status='pending'").run(error, jobId);
        this.db.query("UPDATE evaluations SET status='error',error=? WHERE job_id=? AND status='pending'").run(error, jobId);
      }
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
    const savedEvaluations = this.db.query<{ evaluator_id: string; name: string; provider: string; model: string; status: string; error: string | null }, [string]>("SELECT evaluator_id,name,provider,model,status,error FROM evaluations WHERE job_id=? ORDER BY rowid").all(jobId);
    const evaluations = savedEvaluations.length ? savedEvaluations : [{ evaluator_id: "legacy", name: metrics.text_model, provider: metrics.text_provider, model: metrics.text_model, status: metrics.status, error: metrics.error }];
    const answerRows = this.db.query<{ evaluator_id: string; task_id: string; observed_json: string | null; matches_expected: number | null; status: string; error: string | null }, [string]>("SELECT * FROM answer_rows WHERE job_id=?").all(jobId);
    return { jobId, metrics, models, evaluations, modelMetrics: this.modelMetrics(jobId), tasks: rows.map(t => {
      const answers = evaluations.map(e => {
        const a = answerRows.find(a => a.evaluator_id === e.evaluator_id && a.task_id === t.task_id);
        const scored = t.validity === "valid" && a?.status === "completed";
        return { evaluatorId: e.evaluator_id, model: e.model, name: e.name, provider: e.provider,
          modelAnswer: a?.observed_json == null ? null : JSON.parse(a.observed_json),
          status: a?.status ?? "pending", matchesExpected: a?.matches_expected == null ? null : Boolean(a.matches_expected),
          failed: scored ? a?.matches_expected === 0 : null,
          outcome: a?.status === "error" ? "error" : scored ? (a?.matches_expected ? "success" : "model_failure") : "excluded", error: a?.error ?? null };
      });
      const scored = t.validity === "valid" && t.status === "completed";
      return { jobId, taskId: t.task_id, image: t.image, question: t.question, answerType: t.answer_type, answers,
        expectedAnswer: JSON.parse(t.expected_json), validity: t.validity, reviewNote: t.review_note,
        // Preserve the old export shape only for genuinely single-model historical runs.
        ...(!savedEvaluations.length ? { modelAnswer: t.observed_json === null ? null : JSON.parse(t.observed_json), status: t.status,
        matchesExpected: t.matches_expected === null ? null : Boolean(t.matches_expected),
        failed: scored ? t.matches_expected === 0 : null,
        outcome: t.status === "error" ? "error" : scored ? (t.matches_expected ? "success" : "model_failure") : "excluded",
        error: t.error } : {}) };
    }) };
  }

  close() { this.db.close(); }
}
