import type { Floorplan, Question } from "../validate/schema";

export const GENERATOR_VERSION = "partition-v1";
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let x = state;
    x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

export function generateSeeded(seed: number): { plan: Floorplan; question: Question } {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be a uint32 integer");
  const rng = random(seed);
  const integer = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const width = integer(14, 20), height = integer(12, 18), count = integer(4, 6);
  const rectangles = [{ x: 0, y: 0, width, height }];
  while (rectangles.length < count) {
    const options = rectangles.flatMap((r, i) => [
      ...(r.width >= 6 ? [{ i, vertical: true }] : []), ...(r.height >= 6 ? [{ i, vertical: false }] : []),
    ]);
    if (!options.length) throw new Error("No valid partition available");
    const { i, vertical } = options[integer(0, options.length - 1)]!;
    const r = rectangles.splice(i, 1)[0]!;
    const cut = integer(3, (vertical ? r.width : r.height) - 3);
    rectangles.push(vertical ? { ...r, width: cut } : { ...r, height: cut });
    rectangles.push(vertical ? { ...r, x: r.x + cut, width: r.width - cut } : { ...r, y: r.y + cut, height: r.height - cut });
  }
  const names = ["Living room", "Kitchen", "Bedroom", "Bathroom", "Office", "Study"];
  const rooms = rectangles.sort((a,b) => a.y - b.y || a.x - b.x).map((r, i) => ({ ...r, id: `R${i + 1}`, name: names[i]! }));
  const candidates: { from: string; to: string }[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i]!, b = rooms[j]!;
    const shared = ((a.x + a.width === b.x || b.x + b.width === a.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y,b.y))
      || ((a.y + a.height === b.y || b.y + b.height === a.y) && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x,b.x));
    if (shared) candidates.push({ from: a.id, to: b.id });
  }
  for (let i = candidates.length - 1; i > 0; i--) { const j = integer(0,i); [candidates[i],candidates[j]] = [candidates[j]!,candidates[i]!]; }
  const parent = new Map(rooms.map(r => [r.id, r.id]));
  const root = (id: string): string => parent.get(id) === id ? id : root(parent.get(id)!);
  const doors: Floorplan["doors"] = [];
  for (const door of candidates) {
    if (root(door.from) !== root(door.to)) { parent.set(root(door.from),root(door.to)); doors.push(door); }
    else if (rng() < 0.3) doors.push(door);
  }
  const plan = { width, height, rooms, doors };
  // The reported questions deliberately use explicit JSON answer types.
  let question: Question;
  if (seed % 3 === 0) question = { id: "door_count", question: "How many interior door openings are shown?", answer: doors.length, answer_type: "integer" };
  else if (seed % 3 === 1) {
    const r = rooms[integer(0,rooms.length - 1)]!;
    question = { id: `${r.id}_width`, question: `What is the labelled width (W) of room ${r.id}, in metres?`, answer: r.width, answer_type: "integer" };
  } else {
    const a = rooms[integer(0,rooms.length - 1)]!, b = rooms.filter(r => r.id !== a.id)[integer(0,rooms.length - 2)]!;
    question = { id: `${a.id}_${b.id}_door`, question: `Is there a direct door opening between rooms ${a.id} and ${b.id}? Answer yes or no.`,
      answer: doors.some(d => [d.from,d.to].includes(a.id) && [d.from,d.to].includes(b.id)) ? "yes" : "no", answer_type: "label" };
  }
  return { plan, question };
}
