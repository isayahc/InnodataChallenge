export type Evaluator = { id: string; name: string; provider: string; model: string };

// Verified provider IDs. Both evaluations use the existing OpenRouter credential.
export const EVALUATORS: Evaluator[] = [
  { id: "opus", name: "Claude Opus 5.5", provider: "openrouter", model: "anthropic/claude-opus-5.5" },
  { id: "luna", name: "GPT-6 Luna", provider: "openrouter", model: "openai/gpt-6-luna" },
];
