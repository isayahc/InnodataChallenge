import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generateImage } from "./agents/image";

const [input, destination] = process.argv.slice(2);
if (!input || !destination) throw new Error("Usage: npm run render -- <floorplan.json> <output-directory>");
const image = await generateImage(JSON.parse(await readFile(resolve(input), "utf8")));
const output = resolve(destination);
await mkdir(output, { recursive: true });
await writeFile(join(output, "floorplan.svg"), image.svg);
await writeFile(join(output, "floorplan.png"), image.bytes);
await writeFile(join(output, "generation.json"), JSON.stringify(image.metadata, null, 2));
console.log(`Rendered: ${output}\nPNG SHA-256: ${image.metadata.pngSha256}`);
