# Innodata Challenge

A floorplan task generator and model evaluation pipeline coordinated by `index.ts`, with SQLite job history.

## Agents

- `agents/floorplan.ts`: OpenCode SDK agent generates a validated 3–6-room JSON layout
  using summaries of previous jobs to vary room sizes, partitions, and door connections.
- `agents/image.ts`: generates an image from the JSON through OpenRouter's Image API.
- `agents/questions.ts`: OpenCode SDK agent organizes questions whose wording and expected
  answers are derived deterministically from JSON, avoiding invented ground truth.
- `agents/verify.ts`: two independent OpenCode SDK sessions answer the same questions from
  the same image, one with Claude Opus 5.5 and one with GPT-6 Luna. Neither sees expected
  answers or the other model's responses. Code compares each response against ground truth.
- `agents/evaluators.ts`: the explicit evaluation model IDs; `agents/evaluate-all.ts` runs
  both and isolates errors so one provider failure cannot erase the other model's results.

Each run generates one image and evaluates its questions once per model. Wrong answers are retained,
not retried away. Every run has a job ID and a persisted result object. Model mistakes do
not fail the process; operational errors exit with code 1 and are recorded separately.

## Run

```powershell
npm install
Copy-Item example.env .env
```

Put your Anthropic and OpenRouter API keys in `.env`, then run:

```powershell
npm start
```

Floorplan and question agents use Anthropic's Claude Haiku 4.5 by default. Image generation uses
`bytedance-seed/seedream-4.5` through OpenRouter. Set `TEXT_PROVIDER=openrouter` in `.env`
for OpenRouter-only operation; then only the OpenRouter key is required.

Image evaluation always runs **both** models through OpenRouter:

| Evaluation | Provider | Exact model ID |
| --- | --- | --- |
| Claude Opus 5.5 | OpenRouter | `anthropic/claude-opus-5.5` |
| GPT-6 Luna | OpenRouter | `openai/gpt-6-luna` |

`TEXT_PROVIDER` and `TEXT_MODEL` only affect generation/question agents, not evaluation.
Both evaluation sessions start independently with identical image/question inputs.

| Setting | Default | Purpose |
| --- | --- | --- |
| `TEXT_PROVIDER` | `anthropic` | `anthropic` or `openrouter` |
| `TEXT_MODEL` | Claude Haiku 4.5 | Generation/question-agent model ID |
| `IMAGE_MODEL` | `bytedance-seed/seedream-4.5` | OpenRouter Image API model |
| `OUTPUT_DIR` | `outputs` | Parent directory for job outputs |
| `DATABASE_PATH` | `OUTPUT_DIR/history.sqlite` | Persistent SQLite history |

Requests use provider credits. Each run generates one image and makes two separate model evaluations.
The script runs with project-local Bun (installed by npm) and automatically loads `.env`.
Keep `.env` private; it is ignored by Git.

## Generation history and duplicate prevention

Floorplan and question agents receive a compact summary of the 12 most recent saved layouts:
room geometry, door connections, question categories, and reviewed per-model metrics.
The exact summary supplied is saved in `generation-context.json`. Opus and Luna receive
only the current image/questions, never this history or expected answers.

Before image generation, a canonical fingerprint checks **all** stored layouts, not just
the recent prompt summaries. Room IDs, names, array order, door direction, normalized scaling,
rotations, and reflections do not make a layout new. Room geometry/proportions or door
connectivity must differ. A unique SQLite constraint prevents concurrent duplicate reservations.
This is structural duplicate detection, not a guarantee that every task is semantically novel.

A duplicate proposal gets corrective feedback, up to four proposals total. Exhaustion stops
the job before image generation. Reserved plans stay in history even if a later API call fails.
Question wording/answers remain deterministically derived from JSON; history influences
their organization rather than inventing unverifiable answers. A fresh database starts empty.

## Outputs

```text
outputs/
  history.sqlite
  <job-id>/
    floorplan.json
    generation-context.json
    novelty.json       # Proposal attempts and historical layout count
    questions.json
    floorplan.jpg       # Extension follows the actual image format
    generation.json    # Image model, prompt, reported usage
    verification.json  # Separate Opus/Luna comparisons or errors
    result.json        # Per-model metrics; each task has an answers array
```

Evaluation errors are recorded per model in SQLite and `verification.json`; other pipeline
errors also produce `error.json`. This version checks room/door counts,
labelled dimensions, and direct door connectivity. It does not certify pixel-accurate geometry.

## Validity and historical metrics

Every task starts as `unreviewed`. Independently inspect the image and expected answer
before marking that question `valid` or `invalid`. Do not use the evaluated model's answer
to decide validity. An incorrect drawing can invalidate one question without invalidating others.

| Task validity / response | Outcome | `failed` | Included in accuracy? |
| --- | --- | --- | --- |
| Valid, correct answer | `success` | `false` | Yes |
| Valid, wrong answer | `model_failure` | `true` | Yes |
| Invalid or unreviewed | `excluded` | `null` | No |
| API error or missing response | `error` | `null` | No |

A model explicitly answering `null` (unreadable/abstained) is a completed but incorrect
answer on a valid task. An omitted response is an error. `matchesExpected` records the raw
JSON comparison independently of validity. Accuracy is successes / (successes + model failures),
or `null` when nothing is eligible. This is computed separately per model. A shared validity
review excludes an invalid task from both models' scores; an API error affects only its model.
Unique task counts are not doubled. Job errors are retained even if no tasks were generated.

```sh
npm run history -- metrics
npm run history -- metrics <job-id>
npm run history -- show <job-id>
npm run history -- review <job-id> room_count valid "Image clearly shows four rooms"
npm run history -- review <job-id> L_B_door invalid "Image omits the door specified in JSON"
```

Use actual IDs from `show`. Reviews are per task and require a note. They update live SQLite
metrics and the job's `result.json`; every review is retained in the `reviews` audit table.
You can reset a task to `unreviewed` with the same command. SQLite contains `jobs`, `tasks`,
`reviews`, `evaluations`, `evaluation_answers`, `generated_plans`, and the `job_metrics` / `answer_rows` views.
Legacy single-model records remain visible under their original model, never relabeled as Opus/Luna.
Keep the database and its WAL files together while running.
Old pre-SQLite output folders are not automatically imported.

## Dashboard

```sh
npm run dashboard
```

Open **http://127.0.0.1:3000**. There are two pages:

- `/`: unique task/job counts, cumulative metrics per evaluation model, and individual runs
  with separate Opus/Luna accuracy. Click a job ID to open it.
- `/jobs/<job-id>`: image, JSON, models per stage, per-model metrics, and side-by-side answers.
  On mobile the task table becomes cards with stacked model results.

Expand **Review validity** on a task, select its validity, enter a note, and save. The job's
metrics and cumulative totals update in SQLite immediately. Use **Refresh data** to load new jobs.
Unreviewed/invalid tasks are not shown as passes or failures, even when their raw answers differ.
Accuracy is computed across eligible tasks, not averaged across job percentages.

The dashboard uses the same `DATABASE_PATH` / `OUTPUT_DIR` as the pipeline. It binds locally
by default. Set `DASHBOARD_PORT` to change the port; `DASHBOARD_HOST` is available for Docker.
New jobs save models per stage; older jobs display their stored shared text/image model settings.
An early failed job lists its configured models even if a stage did not execute.

## Run in Docker

With Docker running and your API key in `.env`:

```sh
docker build -t innodata-challenge .
docker run --rm --env-file .env -v "${PWD}/outputs:/app/outputs" innodata-challenge
```

For OpenRouter:

```sh
docker run --rm --env-file .env -e TEXT_PROVIDER=openrouter -v "${PWD}/outputs:/app/outputs" innodata-challenge
```

The image uses Debian-based `oven/bun:1.4.4`, installs the OpenCode SDK from
the dependency lockfile, and runs as the non-root `bun` user. No separate
OpenCode CLI installation is needed. `.env` stays outside the image; Docker
passes the keys at runtime. The output mount preserves results after the container exits.
The default database is also inside this mount. If you override `DATABASE_PATH`, mount its
directory too. Query history in Docker with:

```sh
docker run --rm -v "${PWD}/outputs:/app/outputs" --entrypoint bun innodata-challenge run history.ts metrics
```

Run review commands in the same environment that generated the job so its saved artifact paths resolve.

Run the dashboard from the image (no API keys required):

```sh
docker run --rm -p 127.0.0.1:3000:3000 -e DASHBOARD_HOST=0.0.0.0 -v "${PWD}/outputs:/app/outputs" --entrypoint bun innodata-challenge run dashboard.ts
```

## Checks

```sh
npm run check
npm test
```

Tests cover layout validation, answer comparison, SQLite persistence, validity changes,
error exclusion, and historical metrics. This is not yet a complete challenge submission.
