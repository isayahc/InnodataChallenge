# Innodata Challenge

A floorplan task generator and model evaluation pipeline coordinated by `index.ts`, with SQLite job history.

## Reported folders

- Task folder: `tasks/final` — 10 tasks, seeds 1001–1010, with PNG/SVG images,
  per-task JSON, `tasks.jsonl`, and a SHA-256 manifest.
- Results folder: `results/final` — model responses, raw provider responses,
  `run_config.json`, and `summary.json`.

The reported generator is `generator/seeded.ts` (`partition-v1`). It deterministically
partitions rectangles and constructs connected door graphs. `submission.ts` runs the
implementations in `validate/` (geometry, independent references, SVG legibility checks)
and `eval/` (OpenRouter calls, prompt, extraction, scoring, and reporting).
The interactive LLM generator below remains a separate exploratory workflow.

## Pilot results

Exploratory generative-image pilots achieved 13/16 and then 15/16 raw answer matches.
A subsequent dual-model pilot achieved Opus 14/16 and Luna 12/16. We replaced generated
images with deterministic SVG/PNG rendering to make doors and labels consistent with
the reference geometry, and added bounded corrective retries for invalid layouts.
The deterministic-render pilot (`759a1685-0add-4007-97e1-6d98e7e0f9d4`)
achieved 29/29 raw matches for each model before task-validity review.
These are exploratory results, not reviewed final benchmark scores.

The final Docker replay scored **10/10 (100%) for each model**, with 20 parsed,
complete responses and zero errors. All rebuilt artifact hashes matched.
Full final responses and settings are in `results/final`.

For submission replay we added a seeded procedural generator, pinned rendering dependencies,
independent reference recomputation, and artifact hash checks. The reported tasks test
door counting, labelled widths, and direct connectivity; these basic tasks may be easy
for both models. No task was selected based on a model's final answer.

## Local exploratory workflow

See the installation and run steps below for the interactive generator and dashboard.

## Hand check

AI-assisted visual inspection of all 10 PNGs found readable labels and the following
evidence. These notes are not a claim of human review; human sign-off is still pending.

| Task | Visual evidence for reference |
| --- | --- |
| floorplan-1001 | R2 and R3 share a horizontal wall with a door opening: yes. |
| floorplan-1002 | Six openings: R1–R2, R2–R3, R3–R4, R3–R5, R2–R5, R4–R5. |
| floorplan-1003 | R5 label reads W=13m. |
| floorplan-1004 | R2–R3 shared wall is solid: no direct door. |
| floorplan-1005 | Five openings: R1–R3, R2–R3, R2–R4, R3–R5, R4–R5. |
| floorplan-1006 | R5 label reads W=3m. |
| floorplan-1007 | R2–R4 horizontal wall has a door: yes. |
| floorplan-1008 | Four openings: R1–R2, R2–R3, R2–R5, R4–R5. |
| floorplan-1009 | R4 label reads W=9m. |
| floorplan-1010 | R2 and R6 are separated by other rooms: no direct door. |

## Limitations and manual interventions

The ten tasks are a small, simple benchmark, not a representative measure of general
floorplan reasoning. Room names and proportions need not describe practical architecture.
Automated legibility checks inspect SVG font sizes and door counts, not OCR of the PNG.
No reported images or references were hand-edited. During Docker testing, one Opus
response included prose before valid JSON; extraction was generalized to accept a
schema-valid trailing JSON array, and the complete evaluation was rerun.

## Pipeline and reused components

Seeded partition generation → pinned SVG/PNG renderer → `validate/` geometry,
reference and legibility checks → independent `eval/` model calls → extraction,
exact numeric / case-normalized label comparison → per-model summary.
The renderer uses resvg and DejaVu fonts; schemas use Zod; execution uses Bun.
The exploratory workflow additionally uses the OpenCode SDK and SQLite history.

## Task difficulty

Unequal room sizes and varied partition/door graphs provide visual variation,
but the final tasks did not cause answer errors in either model. These results
do not establish a difficult benchmark. More complex spatial reasoning would
require a new version and a separately reported evaluation.

## Team contributions

AI assistance was used for implementation, testing, documentation and visual inspection.
Human team membership and individual contributions have not yet been supplied;
the team must complete this attribution before final submission.

## Local installation

### 1. Install and configure

You need Git and Node.js/npm (Node.js 22 or newer). `npm install` installs the project-local
Bun runtime used to run the application; no separate Bun or OpenCode CLI installation is required.
Docker is optional.

```sh
git clone https://github.com/isayahc/InnodataChallenge.git
cd InnodataChallenge
npm install
```

Create your local environment file once:

```powershell
# Windows PowerShell
Copy-Item example.env .env
```

On macOS/Linux, use `cp example.env .env` instead. Edit `.env` and add your Anthropic and
OpenRouter keys. OpenRouter is required for both evaluation models; images render locally without an API.
For OpenRouter-only operation, set `TEXT_PROVIDER=openrouter`; the Anthropic key is then optional.

### 2. Run the main job

From the repository directory:

```sh
npm start
```

This runs `index.ts` once: generate a novel floorplan JSON, render its SVG and PNG, create questions,
and evaluate the same tasks independently with Opus 5.5 and GPT-6 Luna. It prints the job ID
and saves artifacts under `outputs/<job-id>/` and history in `outputs/history.sqlite`.
Run the command again to create another job. Model calls consume provider credits.

### 3. Run the dashboard

Open a **second terminal** in the same repository directory:

```sh
npm run dashboard
```

Visit **http://127.0.0.1:3000**. Leave this command running while using the dashboard;
press **Ctrl+C** to stop it. The dashboard can run alongside jobs and does not generate tasks itself.
Click **Refresh data** after a job finishes, then click its job ID to view its image, JSON,
model answers, and reviews. Mark task validity before expecting scored accuracy.

For container commands, see [Run in Docker](#run-in-docker).

## Agents

- `agents/floorplan.ts`: OpenCode SDK agent generates a validated 3–6-room JSON layout
  using summaries of previous jobs to vary room sizes, partitions, and door connections.
- `agents/image.ts`: deterministically draws geometry as SVG and rasterizes it to PNG with
  pinned `@resvg/resvg-js` and DejaVu fonts. It does not call an image-generation model.
- `agents/questions.ts`: OpenCode SDK agent organizes questions whose wording and expected
  answers are derived deterministically from JSON, avoiding invented ground truth.
- `eval/verify.ts`: two independent OpenRouter requests answer the same questions from
  the same image, one with Claude Opus 5.5 and one with GPT-6 Luna. Neither sees expected
  answers or the other model's responses. Code compares each response against ground truth.
- `eval/evaluators.ts`: the explicit evaluation model IDs; `eval/evaluate-all.ts` runs
  both and isolates errors so one provider failure cannot erase the other model's results.

Each run generates one image and evaluates its questions once per model. Wrong answers are retained,
not retried away. Every run has a job ID and a persisted result object. Model mistakes do
not fail the process; operational errors exit with code 1 and are recorded separately.

## Configuration

Floorplan and question agents use Anthropic's Claude Haiku 4.5 by default. Images use the local
`floorplan-svg-v1/resvg-js@2.6.2` renderer. Set `TEXT_PROVIDER=openrouter` in `.env`
for OpenRouter-only operation; then only the OpenRouter key is required.

Image evaluation always runs **both** models through OpenRouter:

| Evaluation | Provider | Exact model ID |
| --- | --- | --- |
| Claude Opus 5.5 | OpenRouter | `anthropic/claude-opus-5.5` |
| GPT-6 Luna | OpenRouter | `openai/gpt-6-luna` |

`TEXT_PROVIDER` and `TEXT_MODEL` only affect generation/question agents, not evaluation.
Both evaluation requests run independently with identical image/question inputs.

| Setting | Default | Purpose |
| --- | --- | --- |
| `TEXT_PROVIDER` | `anthropic` | `anthropic` or `openrouter` |
| `TEXT_MODEL` | Claude Haiku 4.5 | Generation/question-agent model ID |
| `OUTPUT_DIR` | `outputs` | Parent directory for job outputs |
| `DATABASE_PATH` | `OUTPUT_DIR/history.sqlite` | Persistent SQLite history |

LLM requests use provider credits. Rendering is local and free of API charges. Each run renders
one image and makes two separate model evaluations. The old `IMAGE_MODEL` setting is no longer used.
The script runs with project-local Bun (installed by npm) and automatically loads `.env`.
Keep `.env` private; it is ignored by Git.

## Deterministic rendering

Validated room rectangles define the walls. Shared edges are drawn once, including partial
walls at T-junctions. Every door pair cuts one opening at the midpoint of its shared wall,
with a door leaf and swing arc. Walls without doors remain closed. Rooms have exact ID/name
labels and `W=<width>m H=<height>m`; the horizontal and vertical scales are identical.
The renderer validates input again before drawing and escapes SVG labels.

The same JSON yields the same SVG and PNG in the pinned runtime, without an image model
interpreting or changing the geometry. Room/door array ordering does not change the image.
Dependencies are pinned to `@resvg/resvg-js@2.6.2` and `dejavu-fonts-ttf@2.37.3`;
system fonts are disabled. `generation.json` records renderer/font versions, font hash,
render settings, and SHA-256 hashes of the SVG and PNG. Keep the lockfile and Docker runtime
fixed for reproducibility; compare hashes when changing platforms or dependencies.

This is **JSON-to-image determinism**, not seed-to-layout determinism: the layout is still
LLM-generated. Reviews remain available for checking readability and renderer/question issues;
new tasks are not automatically marked valid. Historical image-model runs retain their original metadata.

Re-render a saved JSON without running the layout generator, evaluators, or any API calls:

```sh
npm run render -- outputs/<job-id>/floorplan.json outputs/render-preview
```

This writes `floorplan.svg`, `floorplan.png`, and `generation.json` to the specified directory
without creating a benchmark job. Invalid input fails validation before files are written.
The renderer fixture produced identical PNG hashes on Windows and Linux/amd64 Docker.
The LLM layout generator can still propose invalid geometry. Invalid JSON/geometry receives
corrective feedback and is retried within the four-proposal limit; only validated layouts render.

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

A duplicate or invalid proposal gets corrective feedback, up to four proposals total. Validation
feedback includes the rejected JSON, overlapping room IDs, area discrepancies, and invalid door
connections. Rejections are saved in `floorplan-attempts.json` and logged in the terminal.
Provider/network exceptions are not handled as invalid-layout retries. Exhaustion stops
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
    floorplan.svg       # Exact geometry source
    floorplan.png       # Deterministically rasterized image
    generation.json    # Renderer, fonts, settings, artifact hashes
    verification.json  # Separate Opus/Luna comparisons or errors
    result.json        # Per-model metrics; each task has an answers array
```

Evaluation errors are recorded per model in SQLite and `verification.json`; other pipeline
errors also produce `error.json`. This version checks room/door counts,
labelled dimensions, and direct door connectivity. Deterministic drawing removes generative
image drift, but does not certify architectural/building-code validity or model answer correctness.

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
- `/jobs/<job-id>`: PNG, SVG source link, JSON, models/renderer per stage, per-model metrics, and side-by-side answers.
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

From the repository root, with Docker running, build the complete pipeline:

```sh
docker build -t innodata-challenge .
```

Set `OPENROUTER_API_KEY` in your host shell (PowerShell:
`$env:OPENROUTER_API_KEY = "YOUR_KEY"`; Bash:
`export OPENROUTER_API_KEY="YOUR_KEY"`). Then run this command, valid in either shell:

```sh
docker run --rm -e OPENROUTER_API_KEY -v "${PWD}/submission-run:/app/submission-run" --entrypoint bun innodata-challenge run submission.ts reproduce --output /app/submission-run
```

This rebuilds all 10 reported seeds, checks image/question/reference artifact hashes,
evaluates **both** `anthropic/claude-opus-5.5` and `openai/gpt-6-luna`, and scores their
answers. Rebuilt tasks and results persist in `submission-run/tasks` and
`submission-run/results`. Inspect `summary.json` for per-model scores and error counts;
`responses.jsonl` and `raw/` retain individual and full provider responses.
Temperature is 0 and max output tokens is 4096. Rebuilt tasks must be byte-identical;
provider responses and resulting scores are not guaranteed deterministic.
Operational failures cause a nonzero exit and remain visible in results.

For a fresh seed, use the same pipeline with `fresh --seed 2026 --output /app/submission-run/fresh`
in place of `reproduce --output /app/submission-run`. The fresh task is evaluated by both models.

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

Package and check the submission from the repository root (Docker only):

```sh
docker run --rm -v "${PWD}:/repo" -w /repo python:3.12-slim python submission/package.py
docker run --rm -v "${PWD}/docs:/checks:ro" -v "${PWD}/submission-run:/submission:ro" python:3.12-slim python /checks/check_submission.py /submission/Innodata_Track2.zip --tasks tasks/final --results results/final --strict
```

The ZIP is `submission-run/Innodata_Track2.zip`. Packaging uses an allowlist and excludes
local `.env`, dependencies, Git history and exploratory outputs. Run the supplied checker
under Linux in Docker: its native Windows folder detection mixes slash separators.
The checker verifies format; human review and team attribution remain separate.

Local code checks:

```sh
npm run check
npm test
```

Tests cover layout validation, answer comparison, SQLite persistence, validity changes,
error exclusion, historical metrics, seeded reproducibility and independent references.
