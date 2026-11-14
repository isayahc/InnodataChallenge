import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { generateSeeded, GENERATOR_VERSION } from "./generator/seeded";
import { generateImage } from "./agents/image";
import { validateTasks } from "./validate/tasks";
import { EVALUATORS } from "./eval/evaluators";
import { verifyImage, EvaluationError, TEMPERATURE, MAX_TOKENS, PROMPT } from "./eval/verify";
import { summarize, type ResponseRow } from "./eval/report";

const args = process.argv.slice(2), command = args.shift();
const option = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] ?? fallback : fallback; };
const output = resolve(option("--output", "submission-run"));
const manifest = JSON.parse(await readFile(new URL("./submission/seeds.json", import.meta.url), "utf8"));
if (manifest.generator_version !== GENERATOR_VERSION) throw new Error("Generator version mismatch");
const seeds: number[] = command === "fresh" ? [Number(option("--seed", "2026"))] : manifest.seeds;
if (!["build", "reproduce", "fresh"].includes(command ?? "")) throw new Error("Use submission.ts build|reproduce|fresh [--output DIR] [--seed N]");
const evaluate = command !== "build";
if (evaluate && !process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY at runtime");
const tasksDir = resolve(option("--tasks",join(output,"tasks"))), resultsDir = resolve(option("--results",join(output,"results")));
const submitted: Record<string,string> | null = command === "reproduce"
  ? JSON.parse(await readFile(new URL("./tasks/final/hashes.json",import.meta.url),"utf8")) : null;
await mkdir(tasksDir,{recursive:true}); await mkdir(join(resultsDir,"raw"),{recursive:true});
const records: object[] = [], rows: ResponseRow[] = [];
const hashes: Record<string,string> = {};
const save = async (relative: string, content: string | Buffer) => {
  const path = join(tasksDir,relative); await writeFile(path, content);
  hashes[relative] = createHash("sha256").update(content).digest("hex");
  if (submitted && submitted[relative] !== hashes[relative]) throw new Error(`Rebuilt artifact differs from submission: ${relative}`);
};
await writeFile(join(resultsDir,"run_config.json"), JSON.stringify({ models: EVALUATORS.map(e=>e.model), temperature: TEMPERATURE,
  max_tokens: MAX_TOKENS, prompt_template: PROMPT, generator_version: GENERATOR_VERSION, seeds },null,2));
for (const seed of seeds) {
  const taskId = `floorplan-${seed}`;
  const { plan, question } = generateSeeded(seed);
  const image = await generateImage(plan);
  const checks = validateTasks(plan,image.svg,[question]);
  if (!checks.valid) throw new Error(`Validation failed for ${taskId}: ${JSON.stringify(checks)}`);
  await save(`${taskId}.png`,image.bytes);
  await save(`${taskId}.svg`,image.svg);
  await save(`${taskId}.json`,JSON.stringify({ seed, generator_version: GENERATOR_VERSION, floorplan: plan, question, checks, render: image.metadata },null,2));
  records.push({ task_id: taskId, image: `${taskId}.png`, question: question.question, answer: question.answer,
    answer_type: question.answer_type, question_type: question.answer_type, seed, generator_version: GENERATOR_VERSION, data: plan, checks });
  if (evaluate) {
    for (const evaluator of EVALUATORS) {
      console.log(`${taskId}: ${evaluator.name}`);
      try {
        const result = await verifyImage(image.uri,[question],evaluator);
        await writeFile(join(resultsDir,"raw",`${taskId}-${evaluator.id}.json`),JSON.stringify(result.raw,null,2));
        rows.push({ model:evaluator.model,task_id:taskId,status:"ok",parsed:true,question_type:question.answer_type,
          response:result.text,ref_answer:question.answer,correct:result.checks[0]!.correct?1:0,finish_reason:result.finishReason,error:"" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeFile(join(resultsDir,"raw",`${taskId}-${evaluator.id}.json`),JSON.stringify(error instanceof EvaluationError ? error.raw : {error:message},null,2));
        rows.push({ model:evaluator.model,task_id:taskId,status:"api_error",parsed:false,question_type:question.answer_type,
          response:message,ref_answer:question.answer,correct:0,finish_reason:error instanceof EvaluationError?error.finishReason:"error",
          error:error instanceof EvaluationError && error.finishReason==="length"?"length":"api_error" });
      }
    }
    await writeFile(join(resultsDir,"responses.jsonl"),rows.map(r=>JSON.stringify(r)).join("\n")+"\n");
  }
}
await save("tasks.jsonl",records.map(r=>JSON.stringify(r)).join("\n")+"\n");
await writeFile(join(tasksDir,"hashes.json"),JSON.stringify(hashes,null,2));
if (command === "reproduce") {
  if (JSON.stringify(hashes)!==JSON.stringify(submitted)) throw new Error("Rebuilt tasks differ from submitted artifact hashes");
  console.log("All reported task hashes match the submission.");
}
await writeFile(join(resultsDir,"summary.json"),JSON.stringify(summarize(rows),null,2));
console.log(`Saved ${records.length} tasks to ${tasksDir}; results to ${resultsDir}`);
if (rows.some(r=>r.status!=="ok")) { console.error("Incomplete model responses: see raw errors. This is not a valid final result set."); process.exitCode=1; }
