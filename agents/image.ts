import { Resvg } from "@resvg/resvg-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { floorplanSchema, type Floorplan } from "./schema";

export const RENDERER_ID = "floorplan-svg-v1/resvg-js@2.6.2";
export const SCALE = 100; // pixels/metre; identical horizontal and vertical scale
export const MARGIN = 70;
const fontPath = fileURLToPath(import.meta.resolve("dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf"));
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const number = (value: number) => Number(value.toFixed(6));
type Room = Floorplan["rooms"][number];
export type Segment = { axis: "h" | "v"; coordinate: number; start: number; end: number };
export type Door = Segment & { from: string; to: string; swing: number };
const compareRooms = (a: Room, b: Room) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;

export function buildGeometry(input: Floorplan) {
  const plan = floorplanSchema.parse(input);
  const rooms = [...plan.rooms].sort(compareRooms);
  const doors: Door[] = plan.doors.map(connection => {
    const [a, b] = [rooms.find(r => r.id === connection.from)!, rooms.find(r => r.id === connection.to)!].sort(compareRooms) as [Room, Room];
    const vertical = a.x + a.width === b.x || b.x + b.width === a.x;
    const axis = vertical ? "v" as const : "h" as const;
    const coordinate = vertical ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const start = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    const end = vertical ? Math.min(a.y + a.height, b.y + b.height) : Math.min(a.x + a.width, b.x + b.width);
    // Keep door arcs away from corners, T-junctions, and room-centred labels.
    const width = Math.min(0.9, (end - start) * 0.6, (vertical ? a.width : a.height) * 0.35);
    return { axis, coordinate, start: number((start + end - width) / 2), end: number((start + end + width) / 2),
      from: a.id, to: b.id, swing: vertical ? (a.x < coordinate ? -1 : 1) : (a.y < coordinate ? -1 : 1) };
  }).sort((a, b) => a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : a.coordinate - b.coordinate || a.start - b.start);

  // Integer geometry allows exact unit-edge deduplication, including partial shared walls.
  const edges = new Map<string, Segment>();
  const add = (axis: "h" | "v", coordinate: number, start: number, end: number) => {
    for (let i = start; i < end; i++) edges.set(`${axis}:${coordinate}:${i}`, { axis, coordinate, start: i, end: i + 1 });
  };
  for (const r of rooms) {
    add("h", r.y, r.x, r.x + r.width); add("h", r.y + r.height, r.x, r.x + r.width);
    add("v", r.x, r.y, r.y + r.height); add("v", r.x + r.width, r.y, r.y + r.height);
  }
  const walls: Segment[] = [];
  for (const edge of edges.values()) {
    let fragments = [edge];
    for (const door of doors.filter(d => d.axis === edge.axis && d.coordinate === edge.coordinate)) {
      fragments = fragments.flatMap(segment => {
        if (door.end <= segment.start || door.start >= segment.end) return [segment];
        return [segment.start < door.start ? { ...segment, end: door.start } : null,
          door.end < segment.end ? { ...segment, start: door.end } : null].filter((s): s is Segment => s !== null);
      });
    }
    walls.push(...fragments);
  }
  return { plan, rooms, walls, doors };
}

export function renderSvg(input: Floorplan) {
  const { plan, rooms, walls, doors } = buildGeometry(input);
  const width = Math.max(640, plan.width * SCALE + MARGIN * 2);
  const height = plan.height * SCALE + MARGIN * 2;
  const px = (v: number) => number(MARGIN + v * SCALE);
  const wallLines = walls.map(w => {
    const exterior = w.coordinate === 0 || w.coordinate === (w.axis === "h" ? plan.height : plan.width);
    const [x1, y1, x2, y2] = w.axis === "h" ? [w.start, w.coordinate, w.end, w.coordinate] : [w.coordinate, w.start, w.coordinate, w.end];
    return `<line x1="${px(x1)}" y1="${px(y1)}" x2="${px(x2)}" y2="${px(y2)}" stroke-width="${exterior ? 6 : 4}"/>`;
  }).join("\n");
  const doorPaths = doors.map(d => {
    const r = number((d.end - d.start) * SCALE);
    const x = px(d.axis === "v" ? d.coordinate : d.start), y = px(d.axis === "v" ? d.start : d.coordinate);
    const [closedX, closedY, leafX, leafY] = d.axis === "v" ? [x, y + r, x + d.swing * r, y] : [x + r, y, x, y + d.swing * r];
    const sweep = d.axis === "v" ? Number(d.swing < 0) : Number(d.swing > 0);
    return `<g data-door="${xml(d.from)}:${xml(d.to)}"><line x1="${x}" y1="${y}" x2="${number(leafX)}" y2="${number(leafY)}" stroke-width="2"/><path d="M ${number(closedX)} ${number(closedY)} A ${r} ${r} 0 0 ${sweep} ${number(leafX)} ${number(leafY)}" fill="none" stroke-width="1"/></g>`;
  }).join("\n");
  const labels = rooms.map(r => {
    const lines = [r.id, r.name, `W=${r.width}m H=${r.height}m`];
    // A monospaced, pinned font makes text fitting independent of host fonts.
    const size = number(Math.min(18, (r.width * SCALE - 18) / (Math.max(...lines.map(s => [...s].length)) * 0.61), r.height * SCALE / 7));
    const x = px(r.x + r.width / 2), y = px(r.y + r.height / 2);
    return `<g data-room="${xml(r.id)}" font-size="${size}">${lines.map((line, i) => `<text x="${x}" y="${number(y + (i - 1) * size * 1.4)}">${xml(line)}</text>`).join("")}</g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="white"/>
<g stroke="black" stroke-linecap="butt" fill="none" id="walls">${wallLines}</g>
<g stroke="black" fill="none" id="doors">${doorPaths}</g>
<g font-family="DejaVu Sans Mono" text-anchor="middle" dominant-baseline="middle" fill="black" id="labels">${labels}</g>
<g font-family="DejaVu Sans Mono" font-size="15" fill="black"><text x="${MARGIN}" y="30">N ↑</text><text x="${MARGIN}" y="${height - 22}">Dimensions in metres · W east–west · H north–south</text></g>
</svg>`;
}

export async function generateImage(plan: Floorplan) {
  const svg = renderSvg(plan);
  const renderer = new Resvg(svg, {
    font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans Mono" },
    dpi: 96, shapeRendering: 2, textRendering: 2, fitTo: { mode: "original" }, background: "white",
  });
  const rendered = renderer.render();
  const bytes = rendered.asPng();
  return { bytes, svg, uri: `data:image/png;base64,${bytes.toString("base64")}`, extension: "png", model: RENDERER_ID,
    metadata: { renderer: RENDERER_ID, engine: "@resvg/resvg-js", engineVersion: "2.6.2",
      font: "dejavu-fonts-ttf@2.37.3/DejaVuSansMono.ttf", fontSha256: hash(readFileSync(fontPath)),
      width: rendered.width, height: rendered.height, pixelsPerMetre: SCALE, margin: MARGIN, dpi: 96,
      systemFonts: false, svgSha256: hash(svg), pngSha256: hash(bytes) } };
}
