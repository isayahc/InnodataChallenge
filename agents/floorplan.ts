import { z } from "zod";
import { ask, type Host } from "./runtime";
import { floorplanSchema } from "./schema";

export async function generateFloorplan(host: Host) {
  return ask(host, "floorplan", `Design a simple apartment with exactly four rectangular rooms:
living room, kitchen, bedroom, bathroom. Tile a rectangular footprint completely with no overlap.
Use integer metre dimensions, a simple 2x2 arrangement, and a connected set of interior doors.
Coordinates: origin top-left, x increases east/right, y increases south/down. Width is east-west.
Each door joins two rooms sharing a wall; it will be drawn at the midpoint of their shared wall.
No exterior doors or windows in this first sample. Give every room a unique uppercase ID.
Return an object matching this JSON schema:
${JSON.stringify(z.toJSONSchema(floorplanSchema))}`, floorplanSchema);
}
