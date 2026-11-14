import type { Floorplan } from "./schema";

export async function generateImage(plan: Floorplan) {
  const model = process.env.IMAGE_MODEL ?? "bytedance-seed/seedream-4.5";
  const prompt = `Draw an accurate black-and-white top-down architectural floorplan from this JSON.
Origin top-left, x right/east, y down/south. Draw exactly the rectangles at their coordinates.
Label every room with its exact ID and name, and "W=<width>m H=<height>m" from the JSON.
Show north pointing up. Thick exterior walls, thin interior walls, no perspective or decoration.
Draw one door opening with a swing arc at the midpoint of the shared wall for each door pair.
Do not add other doors, rooms, windows, furniture, or entrances. Preserve all dimensions.
Floorplan JSON: ${JSON.stringify(plan)}`;
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, n: 1, output_format: "png" }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Image API returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  const result = await response.json() as { data?: { b64_json: string; media_type?: string }[]; usage?: unknown };
  const image = result.data?.[0];
  if (!image?.b64_json) throw new Error("Image API returned no image");
  const bytes = Buffer.from(image.b64_json, "base64");
  // Some providers return JPEG even when PNG was requested. Inspect the bytes.
  const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? { mime: "image/png", extension: "png" }
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? { mime: "image/jpeg", extension: "jpg" }
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
        ? { mime: "image/webp", extension: "webp" } : null;
  if (!format) throw new Error("Image API returned an unsupported image format");
  return { bytes, uri: `data:${format.mime};base64,${image.b64_json}`, extension: format.extension, model, prompt, usage: result.usage };
}
