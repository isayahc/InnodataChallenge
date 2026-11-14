import { OpenCode } from "@opencode/sdk";

// Bun automatically loads .env. Pass "openrouter" to use OpenRouter instead.
const providerID = process.argv[2] ?? "anthropic";
const keys = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };
const key = process.env[keys[providerID]];
if (!keys[providerID] || !key || key.startsWith("your_")) {
  console.error("Add your API key to .env, then run npm start or npm start -- openrouter.");
  process.exit(1);
}

const opencode = await OpenCode.create();
try {
  const session = await opencode.sessions.create({
    location: { directory: process.cwd() },
    model: {
      providerID,
      id: providerID === "anthropic" ? "claude-haiku-4-5" : "anthropic/claude-haiku-4.5",
    },
  });

  await opencode.sessions.prompt({ sessionID: session.id, text: "Say hello." });
  await opencode.experimental.session.wait(
    { sessionID: session.id },
    { signal: AbortSignal.timeout(120_000) },
  );
  const messages = await opencode.sessions.context({ sessionID: session.id });
  const response = messages
    .filter((message) => message.type === "assistant")
    .flatMap((message) => message.content)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  if (!response) throw new Error("No text response received. Check your API key and model access.");
  console.log(response);
} finally {
  await opencode.close();
}
