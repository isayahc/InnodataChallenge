import { floorplanSchema, type Floorplan, type Question } from "./schema";

// Independent reference calculation: no import from the question generator or scorer.
export function recomputeAnswer(plan: Floorplan, id: string): number | string {
  if (id === "room_count") return new Set(plan.rooms.map(r => r.id)).size;
  if (id === "door_count") return new Set(plan.doors.map(d => [d.from, d.to].sort().join("|")).map(String)).size;
  for (const room of plan.rooms) {
    if (id === `${room.id}_width`) return (room.x + room.width) - room.x;
    if (id === `${room.id}_height`) return (room.y + room.height) - room.y;
  }
  const neighbours = new Map(plan.rooms.map(r => [r.id, new Set<string>()]));
  for (const door of plan.doors) { neighbours.get(door.from)!.add(door.to); neighbours.get(door.to)!.add(door.from); }
  for (const a of plan.rooms) for (const b of plan.rooms) {
    if (a.id !== b.id && id === `${a.id}_${b.id}_door`) return neighbours.get(a.id)!.has(b.id) ? "yes" : "no";
  }
  throw new Error(`Unknown question identifier: ${id}`);
}

export function validateTasks(input: Floorplan, svg: string, questions: Question[]) {
  const geometry = floorplanSchema.safeParse(input);
  if (!geometry.success) return { valid: false, geometry: false, errors: geometry.error.issues.map(i => i.message), tasks: [] };
  const plan = geometry.data;
  const fontSizes = [...svg.matchAll(/data-room="[^"]+" font-size="([\d.]+)"/g)].map(m => Number(m[1]));
  const labelsLegible = fontSizes.length === plan.rooms.length && fontSizes.every(size => size >= 12);
  const doorCount = [...svg.matchAll(/data-door="/g)].length;
  const rendererConsistent = doorCount === plan.doors.length;
  const tasks = questions.map(q => {
    let recomputed: number | string | null = null;
    try { recomputed = recomputeAnswer(plan, q.id); } catch { /* report unknown references as invalid */ }
    return { id: q.id, referenceMatches: recomputed === q.answer, recomputed, labelsLegible, rendererConsistent,
      valid: recomputed !== null && recomputed === q.answer && labelsLegible && rendererConsistent };
  });
  return { valid: questions.length > 0 && tasks.every(t => t.valid), geometry: true, errors: [], tasks,
    note: "Programmatic geometry, reference and font-size checks. Human visual review remains separate." };
}
