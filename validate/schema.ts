import { z } from "zod";

const room = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().min(1),
  x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive(),
});
export const floorplanSchema = z.object({
  width: z.number().int().positive().max(30),
  height: z.number().int().positive().max(30),
  rooms: z.array(room).min(3).max(6),
  doors: z.array(z.object({ from: z.string(), to: z.string() })).min(2),
}).superRefine((plan, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(plan.rooms.map(r => r.id)).size !== plan.rooms.length) fail("Duplicate room IDs");
  for (const r of plan.rooms) {
    if (r.x + r.width > plan.width || r.y + r.height > plan.height) fail(`${r.id} is outside bounds`);
  }
  for (let i = 0; i < plan.rooms.length; i++) {
    for (const b of plan.rooms.slice(i + 1)) {
      const a = plan.rooms[i]!;
      if (Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
        && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)) fail(`Rooms ${a.id} and ${b.id} overlap`);
    }
  }
  const roomArea = plan.rooms.reduce((n, r) => n + r.width * r.height, 0);
  if (roomArea !== plan.width * plan.height) fail(`Rooms must tile the footprint: summed room area is ${roomArea}, footprint area is ${plan.width * plan.height}`);
  const seen = new Set<string>();
  for (const door of plan.doors) {
    const a = plan.rooms.find(r => r.id === door.from), b = plan.rooms.find(r => r.id === door.to);
    const id = [door.from, door.to].sort().join(":");
    if (seen.has(id)) fail("Duplicate door");
    seen.add(id);
    if (!a || !b || a === b || !sharedWall(a, b)) fail(`Door ${door.from}–${door.to} must join two distinct existing rooms sharing a wall segment, not just a corner`);
  }
  if (!plan.rooms.length) return; // The array schema already reports the room-count error.
  const reached = new Set([plan.rooms[0]!.id]);
  for (let i = 0; i < plan.rooms.length; i++) for (const d of plan.doors) {
    if (reached.has(d.from)) reached.add(d.to);
    if (reached.has(d.to)) reached.add(d.from);
  }
  if (plan.rooms.some(r => !reached.has(r.id))) fail("Every room must be reachable through doors");
});

function sharedWall(a: z.infer<typeof room>, b: z.infer<typeof room>) {
  return ((a.x + a.width === b.x || b.x + b.width === a.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
    || ((a.y + a.height === b.y || b.y + b.height === a.y)
    && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x));
}

export type Floorplan = z.infer<typeof floorplanSchema>;
export type Question = { id: string; question: string; answer: number | string; answer_type: "integer" | "label" };
