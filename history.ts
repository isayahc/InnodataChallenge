import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { History, type Validity } from "./storage";

const [command = "metrics", jobId, taskId, validity, ...note] = process.argv.slice(2);
const history = new History();
try {
  if (command === "metrics") console.log(JSON.stringify(jobId ? history.metrics(jobId) : history.metrics(), null, 2));
  else if (command === "show" && jobId) console.log(JSON.stringify(history.job(jobId), null, 2));
  else if (command === "review" && jobId && taskId && validity && note.length) {
    history.review(jobId, taskId, validity as Validity, note.join(" "));
    const job = history.job(jobId);
    const location = history.db.query<{ output_dir: string }, [string]>("SELECT output_dir FROM jobs WHERE job_id=?").get(jobId)!;
    // The database is authoritative; refresh the per-run export after a review.
    await writeFile(join(location.output_dir, "result.json"), JSON.stringify(job, null, 2));
    console.log(JSON.stringify(job.metrics, null, 2));
  } else throw new Error('Usage: history.ts metrics [jobId] | show <jobId> | review <jobId> <taskId> <valid|invalid|unreviewed> "note"');
} finally { history.close(); }
