import { z } from "zod";

export class StructuredOutputError extends Error {
  constructor(readonly output: string, readonly validation: string) {
    super(`Invalid model JSON: ${validation}`);
    this.name = "StructuredOutputError";
  }
}

export function parseOutput<T>(text: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new StructuredOutputError(text, error instanceof z.ZodError
        ? error.issues.map(issue => `${issue.path.join(".") || "layout"}: ${issue.message}`).join("\n")
        : error.message);
    }
    throw error;
  }
}
