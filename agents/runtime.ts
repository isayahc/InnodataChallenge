import { OpenCode } from "@opencode/sdk";
import { z } from "zod";
import type { Evaluator } from "./evaluators";
import { parseOutput } from "./structured-output";

export type Host = Awaited<ReturnType<typeof OpenCode.create>>;
export async function ask<T>(host: Host, role: string, prompt: string, schema: z.ZodType<T>, image?: string, evaluator?: Evaluator): Promise<T> {
  const providerID = evaluator?.provider ?? process.env.TEXT_PROVIDER ?? "anthropic";
  if (!["anthropic", "openrouter"].includes(providerID)) throw new Error("TEXT_PROVIDER must be anthropic or openrouter");
  const session = await host.sessions.create({
    title: role,
    location: { directory: process.cwd() },
    model: {
      providerID,
      id: evaluator?.model ?? process.env.TEXT_MODEL ?? (providerID === "anthropic" ? "claude-haiku-4-5" : "anthropic/claude-haiku-4.5"),
    },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  });
  const options = { signal: AbortSignal.timeout(180_000) };
  try {
    await host.sessions.prompt({
      sessionID: session.id,
      text: `You are the ${role} agent. Do not use tools. Return only JSON, without markdown.\n${prompt}`,
      ...(image ? { files: [{ uri: image, name: "floorplan" }] } : {}),
    }, options);
    await host.experimental.session.wait({ sessionID: session.id }, options);
    const messages = await host.sessions.context({ sessionID: session.id }, options);
    const text = messages.filter(m => m.type === "assistant").flatMap(m => m.content)
      .filter(p => p.type === "text").map(p => p.text).join("\n").trim();
    return parseOutput(text, schema);
  } finally {
    // Each task uses an independent session; the verifier cannot see other agents' messages.
    await host.sessions.remove({ sessionID: session.id });
  }
}
