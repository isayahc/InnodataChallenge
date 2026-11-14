import { test, expect } from "bun:test";
import { floorplanSchema } from "../agents/schema";
import { groundTruth } from "../agents/questions";
import { compareAnswers } from "../agents/verify";

const plan = {
  width: 8, height: 8,
  rooms: [
    { id: "A", name: "Living room", x: 0, y: 0, width: 4, height: 4 },
    { id: "B", name: "Kitchen", x: 4, y: 0, width: 4, height: 4 },
    { id: "C", name: "Bedroom", x: 0, y: 4, width: 4, height: 4 },
    { id: "D", name: "Bathroom", x: 4, y: 4, width: 4, height: 4 },
  ],
  doors: [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "B", to: "D" }],
};

test("rejects overlapping rooms and doors between diagonal rooms", () => {
  expect(floorplanSchema.safeParse(plan).success).toBe(true);
  const overlap = structuredClone(plan);
  overlap.rooms[1]!.x = 3;
  expect(floorplanSchema.safeParse(overlap).success).toBe(false);
  const diagonal = structuredClone(plan);
  diagonal.doors[0] = { from: "A", to: "D" };
  expect(floorplanSchema.safeParse(diagonal).success).toBe(false);
});

test("rejects disconnected plans", () => {
  expect(floorplanSchema.safeParse({ ...plan, doors: plan.doors.slice(0, 2) }).success).toBe(false);
});

test("ground truth includes positive and negative connectivity", () => {
  const questions = groundTruth(plan);
  expect(questions.find(q => q.id === "A_B_door")?.answer).toBe("yes");
  expect(questions.find(q => q.id === "A_D_door")?.answer).toBe("no");
  const answers = questions.map(q => ({ id: q.id, answer: q.answer }));
  expect(compareAnswers(questions, answers).passed).toBe(true);
  answers[0]!.answer = 99;
  expect(compareAnswers(questions, answers).passed).toBe(false);
  expect(compareAnswers(questions, []).passed).toBe(false);
  expect(() => compareAnswers(questions, [answers[0]!, answers[0]!])).toThrow();
});
