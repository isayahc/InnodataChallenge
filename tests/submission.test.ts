import { test, expect } from "bun:test";
import { generateSeeded } from "../generator/seeded";
import { generateImage } from "../agents/image";
import { validateTasks, recomputeAnswer } from "../validate/tasks";
import { layoutFingerprint } from "../validate/diversity";
import { summarize } from "../eval/report";
import { extractAnswers } from "../eval/verify";

test("extracts schema-valid trailing answers without inferring prose answers", () => {
  expect(extractAnswers('I counted four doors.\n[{"id":"door_count","answer":4}]')).toEqual([{id:"door_count",answer:4}]);
  expect(() => extractAnswers("I counted four doors.")).toThrow();
  expect(() => extractAnswers('[{"id":"door_count","answer":true}]')).toThrow();
});

test("the ten reported seeds reproduce geometry, references and PNGs", async () => {
  const fingerprints = new Set<string>();
  for (let seed=1001; seed<=1010; seed++) {
    const first=generateSeeded(seed), second=generateSeeded(seed);
    expect(first).toEqual(second);
    const image=await generateImage(first.plan), replay=await generateImage(second.plan);
    expect(image.bytes.equals(replay.bytes)).toBe(true);
    expect(validateTasks(first.plan,image.svg,[first.question]).valid).toBe(true);
    expect(recomputeAnswer(first.plan,first.question.id)).toBe(first.question.answer);
    fingerprints.add(layoutFingerprint(first.plan));
  }
  expect(fingerprints.size).toBe(10);
});

test("independent validation rejects tampered references and illegible labels", async () => {
  const {plan,question}=generateSeeded(1001);
  const image=await generateImage(plan);
  expect(validateTasks(plan,image.svg,[{...question,answer:"incorrect"}]).valid).toBe(false);
  const tiny=image.svg.replace(/(data-room="[^"]+" font-size=")[\d.]+/g,'$14');
  expect(validateTasks(plan,tiny,[question]).valid).toBe(false);
});

test("reports exclude API errors from accuracy and keep them visible", () => {
  expect(summarize([
    {model:"m",task_id:"one",status:"ok",parsed:true,question_type:"integer",response:"4",ref_answer:4,correct:1,finish_reason:"stop",error:""},
    {model:"m",task_id:"two",status:"api_error",parsed:false,question_type:"integer",response:"timeout",ref_answer:4,correct:0,finish_reason:"error",error:"api_error"},
  ])[0]).toMatchObject({tasks:2,completed:1,errors:1,correct:1,accuracy:1});
});
