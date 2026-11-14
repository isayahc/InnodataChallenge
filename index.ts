import { OpenCode } from "@opencode/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generateFloorplan } from "./agents/floorplan";
import { generateImage } from "./agents/image";
import { generateQuestions } from "./agents/questions";
import { verifyImage } from "./agents/verify";
import { History, defaultDatabasePath } from "./storage";

const provider = process.env.TEXT_PROVIDER ?? "anthropic";
const model = process.env.TEXT_MODEL ?? (provider === "anthropic" ? "claude-haiku-4-5" : "anthropic/claude-haiku-4.5");
const jobId = crypto.randomUUID();
const output = resolve(process.env.OUTPUT_DIR ?? "outputs", jobId);
await mkdir(output, { recursive: true });
const save = (path: string, data: unknown) => writeFile(join(output, path), JSON.stringify(data, null, 2));
const history = new History();
history.start({ id: jobId, output, provider, model, imageModel: process.env.IMAGE_MODEL ?? "bytedance-seed/seedream-4.5" });
let host: Awaited<ReturnType<typeof OpenCode.create>> | undefined;
try {
  if (!["anthropic", "openrouter"].includes(provider)) throw new Error("TEXT_PROVIDER must be anthropic or openrouter");
  for (const name of new Set(["OPENROUTER_API_KEY", provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"])) {
    if (!process.env[name] || process.env[name]!.startsWith("your_")) throw new Error(`Set ${name} in .env`);
  }
  host = await OpenCode.create();
  console.log(`Job: ${jobId}\n1. Generating floorplan JSON...`);
  const plan = await generateFloorplan(host);
  await save("floorplan.json", plan);
  console.log("2. Generating image...");
  const image = await generateImage(plan);
  const imagePath = `floorplan.${image.extension}`;
  await writeFile(join(output, imagePath), image.bytes);
  await save("generation.json", { model: image.model, prompt: image.prompt, usage: image.usage });
  console.log("3. Generating question set...");
  const questions = await generateQuestions(host, plan);
  await save("questions.json", questions);
  history.addTasks(jobId, join(output, imagePath), questions);
  console.log("4. Evaluating model answers...");
  const result = await verifyImage(host, image.uri, questions);
  await save("verification.json", result);
  history.recordAnswers(jobId, result.checks);
  history.finish(jobId);
  console.log(`${result.correct}/${result.total} raw answer matches. Tasks await validity review; no model score assigned yet.`);
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
