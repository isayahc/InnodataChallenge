import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutFingerprint, selectNovelPlan } from "../agents/diversity";
import { floorplanSchema, type Floorplan } from "../agents/schema";
import { History } from "../storage";

const original: Floorplan = {
  width: 8, height: 6,
  rooms: [
    { id: "A", name: "Living room", x: 0, y: 0, width: 3, height: 6 },
    { id: "B", name: "Kitchen", x: 3, y: 0, width: 5, height: 2 },
    { id: "C", name: "Bedroom", x: 3, y: 2, width: 5, height: 4 },
  ],
  doors: [{ from: "A", to: "B" }, { from: "A", to: "C" }],
};
const novel = { ...original, doors: [{ from: "A", to: "B" }, { from: "B", to: "C" }] };

test("canonical layout ignores IDs, names, order, scaling, rotations and mirrors", () => {
  const fingerprint = layoutFingerprint(original);
  const renamed = { ...original,
    rooms: [...original.rooms].reverse().map(r => ({ ...r, id: `NEW_${r.id}`, name: "Renamed" })),
    doors: [...original.doors].reverse().map(d => ({ from: `NEW_${d.to}`, to: `NEW_${d.from}` })),
  };
  const scaled = { ...original, width: 16, height: 12,
    rooms: original.rooms.map(r => ({ ...r, x: r.x * 2, y: r.y * 2, width: r.width * 2, height: r.height * 2 })) };
  const rotated = { ...original, width: 6, height: 8,
    rooms: original.rooms.map(r => ({ ...r, x: original.height - r.y - r.height, y: r.x, width: r.height, height: r.width })) };
  const mirrored = { ...original, rooms: original.rooms.map(r => ({ ...r, x: original.width - r.x - r.width })) };
  for (const plan of [renamed, scaled, rotated, mirrored]) {
    expect(floorplanSchema.safeParse(plan).success).toBe(true);
    expect(layoutFingerprint(plan)).toBe(fingerprint);
  }
  expect(layoutFingerprint(novel)).not.toBe(fingerprint);
  const differentPartition = { ...original, rooms: original.rooms.map(r => r.id === "A" ? { ...r, width: 4 } : { ...r, x: 4, width: 4 }) };
  expect(layoutFingerprint(differentPartition)).not.toBe(fingerprint);
});

test("history persists, and duplicate checks cover layouts outside prompt summaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "floorplan-diversity-"));
  const path = join(dir, "history.sqlite");
  let history = new History(path);
  try {
    for (const id of ["a", "b", "c"]) history.start({ id, output: dir, provider: "test", model: "test", imageModel: "test" });
    expect(history.reservePlan("a", original)).toBe(true);
    expect(history.reservePlan("b", novel)).toBe(true);
    history.close();
    history = new History(path);
    expect(history.generationContext(1).recentJobs).toHaveLength(1);
    expect(history.generationContext(1).totalPastLayouts).toBe(2);
    expect(history.reservePlan("c", original)).toBe(false);
  } finally { history.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("duplicate proposals get feedback before selecting a novel plan; retries are bounded", async () => {
  const feedback: string[] = [];
  const result = await selectNovelPlan(async message => {
    feedback.push(message);
    return feedback.length === 1 ? original : novel;
  }, plan => layoutFingerprint(plan) !== layoutFingerprint(original));
  expect(result.attempts).toBe(2);
  expect(feedback[1]).toContain("duplicates a historical layout");
  let calls = 0;
  await expect(selectNovelPlan(async () => { calls++; return original; }, () => false)).rejects.toThrow("No image was generated");
  expect(calls).toBe(4);
});
