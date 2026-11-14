import { test, expect } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import { buildGeometry, generateImage, renderSvg, SCALE, MARGIN } from "../agents/image";
import type { Floorplan } from "../agents/schema";

const plan: Floorplan = {
  width: 8, height: 6,
  rooms: [
    { id: "A", name: "Living room", x: 0, y: 0, width: 3, height: 6 },
    { id: "B", name: "Kitchen", x: 3, y: 0, width: 5, height: 2 },
    { id: "C", name: "Bedroom", x: 3, y: 2, width: 5, height: 4 },
  ],
  doors: [{ from: "A", to: "B" }, { from: "A", to: "C" }],
};

test("renders byte-identical PNGs, including reordered room/door input", async () => {
  const a = await generateImage(plan);
  const b = await generateImage({ ...plan, rooms: [...plan.rooms].reverse(),
    doors: [...plan.doors].reverse().map(d => ({ from: d.to, to: d.from })) });
  expect(a.svg).toBe(b.svg);
  expect(a.bytes.equals(b.bytes)).toBe(true);
  expect(a.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(a.metadata).toMatchObject({ width: 940, height: 740, systemFonts: false, engineVersion: "2.6.2" });
  expect(a.uri).toBe(`data:image/png;base64,${a.bytes.toString("base64")}`);
  expect(a.metadata.pngSha256).toBe(b.metadata.pngSha256);
});

test("cuts doors only in their shared walls and preserves T-junctions and non-door walls", () => {
  const scene = buildGeometry(plan);
  expect(scene.doors).toHaveLength(2);
  expect(scene.doors.map(d => [d.axis, d.coordinate, (d.start + d.end) / 2])).toEqual([["v", 3, 1], ["v", 3, 4]]);
  for (const door of scene.doors) {
    expect(scene.walls.some(w => w.axis === door.axis && w.coordinate === door.coordinate
      && w.start < door.end && w.end > door.start)).toBe(false);
  }
  // Independently sample actual raster pixels: open door centres are white, a closed
  // shared wall and the T-junction are black. No text is needed for these checks.
  const rendered = new Resvg(renderSvg(plan), { font: { loadSystemFonts: false } }).render();
  const at = (x: number, y: number) => {
    const offset = ((MARGIN + y * SCALE) * rendered.width + MARGIN + x * SCALE) * 4;
    return [...rendered.pixels.subarray(offset, offset + 4)];
  };
  expect(at(3, 1)).toEqual([255, 255, 255, 255]);
  expect(at(3, 4)).toEqual([255, 255, 255, 255]);
  expect(at(5, 2)).toEqual([0, 0, 0, 255]);
  expect(at(3, 2)).toEqual([0, 0, 0, 255]);
  expect(at(0, 3)).toEqual([0, 0, 0, 255]);
});

test("horizontal doors render as real wall gaps without changing connectivity", () => {
  const horizontal: Floorplan = { ...plan, doors: [{ from: "A", to: "B" }, { from: "B", to: "C" }] };
  const { doors } = buildGeometry(horizontal);
  expect(doors.find(d => d.axis === "h")).toMatchObject({ coordinate: 2, from: "B", to: "C" });
  const raster = new Resvg(renderSvg(horizontal), { font: { loadSystemFonts: false } }).render();
  const pixel = (x: number, y: number) => raster.pixels[((MARGIN + y * SCALE) * raster.width + MARGIN + x * SCALE) * 4];
  expect(pixel(5.5, 2)).toBe(255);
  expect(pixel(3, 4)).toBe(0); // Previous A–C door is closed in this layout.
});

test("escapes labels and refuses invalid geometry before rendering", async () => {
  const named = { ...plan, rooms: plan.rooms.map(r => ({ ...r, name: '<script>&"' })) };
  const svg = renderSvg(named);
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;&amp;&quot;");
  expect(svg).toContain("W=3m H=6m");
  await expect(generateImage({ ...plan, doors: [{ from: "A", to: "missing" }] })).rejects.toThrow();
});
