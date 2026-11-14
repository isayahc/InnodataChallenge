import { OpenCode } from "@opencode/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generateFloorplan } from "./agents/floorplan";
import { generateImage } from "./agents/image";
import { generateQuestions } from "./agents/questions";
import { verifyImage } from "./agents/verify";
import { History, defaultDatabasePath } from "./storage";
import { EVALUATORS } from "./agents/evaluators";
import { evaluateAll } from "./agents/evaluate-all";
import { selectNovelPlan } from "./agents/diversity";

const provider = process.env.TEXT_PROVIDER ?? "anthropic";
const model = process.env.TEXT_MODEL ?? (provider === "anthropic" ? "claude-haiku-4-5" : "anthropic/claude-haiku-4.5");
const jobId = crypto.randomUUID();
const output = resolve(process.env.OUTPUT_DIR ?? "outputs", jobId);
await mkdir(output, { recursive: true });
const save = (path: string, data: unknown) => writeFile(join(output, path), JSON.stringify(data, null, 2));
const history = new History();
history.start({ id: jobId, output, provider, model, imageModel: process.env.IMAGE_MODEL ?? "bytedance-seed/seedream-4.5", evaluators: EVALUATORS });
let host: Awaited<ReturnType<typeof OpenCode.create>> | undefined;
try {
  if (!["anthropic", "openrouter"].includes(provider)) throw new Error("TEXT_PROVIDER must be anthropic or openrouter");
  for (const name of new Set(["OPENROUTER_API_KEY", provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"])) {
    if (!process.env[name] || process.env[name]!.startsWith("your_")) throw new Error(`Set ${name} in .env`);
  }
  host = await OpenCode.create();
  console.log(`Job: ${jobId}\n1. Generating floorplan JSON...`);
  const pastJobs = history.generationContext();
  await save("generation-context.json", pastJobs);
  const { plan, attempts } = await selectNovelPlan(
    feedback => generateFloorplan(host!, pastJobs, feedback),
    plan => history.reservePlan(jobId, plan),
  );
  console.log(`Novel layout selected after ${attempts} proposal(s); compared against ${pastJobs.totalPastLayouts} past layouts.`);
  await save("novelty.json", { attempts, pastLayouts: pastJobs.totalPastLayouts });
  await save("floorplan.json", plan);
  console.log("2. Generating image...");
  const image = await generateImage(plan);
  const imagePath = `floorplan.${image.extension}`;
  await writeFile(join(output, imagePath), image.bytes);
  await save("generation.json", { model: image.model, prompt: image.prompt, usage: image.usage });
  console.log("3. Generating question set...");
  const questions = await generateQuestions(host, plan, pastJobs);
  await save("questions.json", questions);
  history.addTasks(jobId, join(output, imagePath), questions);
  console.log("4. Evaluating independently with Claude Opus 5.5 and GPT-6 Luna...");
  const results = await evaluateAll(history, jobId, EVALUATORS, evaluator => verifyImage(host!, image.uri, questions, evaluator));
  await save("verification.json", results);
  const failures = results.filter(r => r.status === "error");
  history.finish(jobId, failures.length ? failures.map(r => `${r.evaluator.name}: ${r.error}`).join("; ") : undefined);
  for (const r of results) console.log(r.status === "completed"
    ? `${r.evaluator.name}: ${r.result.correct}/${r.result.total} raw answer matches.`
    : `${r.evaluator.name}: evaluation error — ${r.error}`);
  if (failures.length) process.exitCode = 1;
  console.log("Task validity is shared across both evaluations; no scores assigned until reviewed.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  history.finish(jobId, message);
  await save("error.json", { message });
  console.error(`Job error: ${message}`);
  process.exitCode = 1;
} finally {
  try {
    await save("result.json", history.job(jobId));
    console.log(`Results: ${output}\nHistory: ${defaultDatabasePath()}`);
  } finally {
    history.close();
    await host?.close();
  }
}
