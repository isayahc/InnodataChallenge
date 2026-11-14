import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { History } from "./storage";

const reviewSchema = z.object({ validity: z.enum(["valid", "invalid", "unreviewed"]), note: z.string().trim().min(1).max(2000) });

export function dashboardHandler(history: History) {
  async function directory(id: string) {
    const job = history.metrics(id);
    if (!job) return null;
    // Support the same output volume on Windows and inside Docker.
    for (const candidate of [job.output_dir, resolve(process.env.OUTPUT_DIR ?? "outputs", id)]) {
      try { await readdir(candidate); return candidate; } catch { /* try mounted path */ }
    }
    return null;
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (request.method === "GET") {
        if (url.pathname === "/api/jobs") return json({ totals: history.cumulative(), jobs: history.metrics() });
        const detail = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(image|floorplan))?$/);
        if (detail) {
          const id = decodeURIComponent(detail[1]!);
          if (!history.metrics(id)) return json({ error: "Job not found" }, 404);
          if (!detail[2]) return json(history.job(id));
          const dir = await directory(id);
          if (!dir) return json({ error: "Artifacts are unavailable for this job" }, 404);
          if (detail[2] === "floorplan") {
            const file = Bun.file(join(dir, "floorplan.json"));
            return await file.exists() ? json(await file.json()) : json({ error: "Floorplan not generated" }, 404);
          }
          const name = (await readdir(dir)).find(name => /^floorplan\.(png|jpg|webp)$/.test(name));
          if (!name) return json({ error: "Image not generated" }, 404);
          return new Response(Bun.file(join(dir, name)), { headers: { "X-Content-Type-Options": "nosniff" } });
        }
        const assets: Record<string, string> = { "/app.js": "app.js", "/style.css": "style.css" };
        if (assets[url.pathname]) return new Response(Bun.file(join(import.meta.dir, "dashboard", assets[url.pathname]!)));
        if (url.pathname === "/" || /^\/jobs\/[^/]+$/.test(url.pathname)) {
          return new Response(Bun.file(join(import.meta.dir, "dashboard", "index.html")));
        }
      }
      const review = url.pathname.match(/^\/api\/jobs\/([^/]+)\/tasks\/([^/]+)\/review$/);
      if (request.method === "POST" && review) {
        if (request.headers.get("origin") !== url.origin) return json({ error: "Same-origin requests required" }, 403);
        const id = decodeURIComponent(review[1]!), task = decodeURIComponent(review[2]!);
        if (!history.metrics(id) || !history.job(id).tasks.some(t => t.taskId === task)) return json({ error: "Task not found" }, 404);
        const parsed = reviewSchema.safeParse(await request.json());
        if (!parsed.success) return json({ error: "Select a validity and enter a review note (1–2000 characters)" }, 400);
        history.review(id, task, parsed.data.validity, parsed.data.note);
        const result = history.job(id);
        let warning: string | undefined;
        try {
          const dir = await directory(id);
          if (!dir) throw new Error("Artifacts unavailable");
          await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2));
        } catch { warning = "Review saved in SQLite; artifact export could not be updated."; }
        return json({ ...result, warning });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "Request failed. Check the dashboard server log." }, 500);
    }
  };
}

if (import.meta.main) {
  const history = new History();
  const server = Bun.serve({ hostname: process.env.DASHBOARD_HOST ?? "127.0.0.1", port: Number(process.env.DASHBOARD_PORT ?? 3000), fetch: dashboardHandler(history) });
  console.log(`Dashboard: ${server.url}`);
  const stop = () => { server.stop(true); history.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
