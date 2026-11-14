import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { History } from "../storage";
import { dashboardHandler } from "../dashboard";

test("dashboard computes weighted totals, serves artifacts, and saves reviews", async () => {
  const dir = mkdtempSync(join(tmpdir(), "floorplan-dashboard-"));
  const history = new History(":memory:");
  try {
    await Bun.write(join(dir, "floorplan.json"), '{"width":8}');
    for (const id of ["one", "two"]) {
      history.start({ id, output: dir, provider: "anthropic", model: "saved-text-model", imageModel: "saved-image-model" });
      const questions = Array.from({ length: id === "one" ? 1 : 3 }, (_, i) => ({ id: String(i), question: "Count?", answer: 4, answer_type: "integer" as const }));
      history.addTasks(id, "floorplan.png", questions);
      history.recordAnswers(id, questions.map(q => ({ id: q.id, observed: id === "one" ? 4 : 5, correct: id === "one" })));
      questions.forEach(q => history.review(id, q.id, "valid", "Fixture reviewed"));
      history.finish(id);
    }
    const fetch = dashboardHandler(history);
    const get = (path: string) => fetch(new Request(`http://localhost:3000${path}`));
    const overview = await (await get('/api/jobs')).json();
    expect(overview.totals).toMatchObject({ jobs: 2, successes: 1, failures: 3, accuracy: 0.25 });
    const detail = await (await get('/api/jobs/one')).json();
    expect(detail.models).toContainEqual({ stage: "image", provider: "openrouter", model: "saved-image-model" });
    // Existing runs without stage rows retain their historical saved model IDs.
    history.db.query("DELETE FROM job_models WHERE job_id=?").run("one");
    expect(history.job("one").models[0]!.model).toBe("saved-text-model");
    expect(await (await get('/api/jobs/one/floorplan')).json()).toEqual({ width: 8 });
    expect((await get('/api/jobs/missing')).status).toBe(404);
    expect((await get('/api/jobs/one/image')).status).toBe(404);
    const review = (origin: string, note: string) => fetch(new Request('http://localhost:3000/api/jobs/two/tasks/0/review', {
      method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ validity: 'invalid', note }),
    }));
    expect((await review('http://example.com', 'bad origin')).status).toBe(403);
    expect((await review('http://localhost:3000', '')).status).toBe(400);
    expect((await review('http://localhost:3000', 'Image mismatch')).status).toBe(200);
    expect(history.cumulative()).toMatchObject({ successes: 1, failures: 2, invalid: 1, accuracy: 1/3 });
    expect((await Bun.file(join(dir, 'result.json')).json()).tasks[0].failed).toBe(null);
    expect((await get('/')).status).toBe(200);
    expect((await get('/jobs/one')).status).toBe(200);
  } finally { history.close(); rmSync(dir, { recursive: true, force: true }); }
});
