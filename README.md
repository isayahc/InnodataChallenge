# Innodata Challenge

A minimal OpenCode SDK smoke test: create a session, send "Say hello", and print the response.

## Run

```powershell
npm install
Copy-Item example.env .env
```

Put your API key in `.env`, then run:

```powershell
npm start
```

This uses Anthropic's Claude Haiku 4.5. To use OpenRouter instead:

```powershell
npm start -- openrouter
```

Only the selected provider's key is required. Requests use your provider account's credits.
The script runs with project-local Bun (installed by npm) and automatically loads `.env`.
Keep `.env` private; it is ignored by Git.
