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

## Docker

With Docker running and your API key in `.env`:

```sh
docker build -t innodata-challenge .
docker run --rm --env-file .env innodata-challenge
```

For OpenRouter:

```sh
docker run --rm --env-file .env innodata-challenge openrouter
```

The image uses Debian-based `oven/bun:1.4.4`, installs the OpenCode SDK from
the dependency lockfile, and runs as the non-root `bun` user. No separate
OpenCode CLI installation is needed. `.env` stays outside the image; Docker
passes the keys at runtime. The container prints the response and exits.

Verified on Docker Desktop with Linux/amd64: image build, SDK startup/shutdown,
and a live Anthropic "Say hello" response. OpenRouter has not been tested in Docker.
