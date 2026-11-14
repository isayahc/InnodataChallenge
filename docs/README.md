# Track 2 submission format checker

`check_submission.py` checks your submission against the required format in Section 5 of the Track 2 guide
("Submission and demo", and "Repository layout and file formats"). It also runs the same checks the judges' app runs
when your ZIP is uploaded. If it reports no FAIL, the app will accept your ZIP and can find and read your reported
tasks and results.

It needs Python 3.8 or later and nothing else: it uses only the standard library. It only reads files. It does not
unzip, build or run anything, and it sends nothing over the network.

## Usage

```bash
python3 check_submission.py MyTeam_Track2.zip          # the ZIP you are about to upload
python3 check_submission.py .                           # your repository, before zipping
python3 check_submission.py MyTeam_Track2.zip --tasks tasks/final --results results/final
```

| Option | Meaning |
|---|---|
| `--tasks DIR`, `--results DIR` | The reported folders, as paths from the repository root. By default they come from your README's "Reported folders" section. |
| `--strict` | Warnings also give exit code 1. |
| `--quiet` | Print only the WARN and FAIL lines. |
| `--json FILE` | Also write the results as JSON (`-` prints only the JSON). |
| `--expected-tasks N` | The size of the reported task set (default 10). |
| `--max-upload-mb`, `--max-uncompressed-mb` | Size limits (defaults 200 and 2000, the judges' app settings). |

The exit code is 0 when no check fails, 1 when a check fails, and 2 when the command is used wrongly. To use it as a
step in your pipeline or CI:

```bash
zip -qr MyTeam_Track2.zip . -x '.git/*' '.venv/*' 'node_modules/*' '*/__pycache__/*' '.env' \
  && python3 check_submission.py MyTeam_Track2.zip
```

## What the results mean

- **FAIL** means a required part is missing or in the wrong format. Either the app refuses the upload, a judge's tool
  cannot read a required file, or a required file, folder, field, column or README section is missing. Fix every FAIL
  before you submit.
- **WARN** means something the guide asks for looks missing or incomplete, or something could stop the judges' tools
  from reading all of your work. Read each warning. Fix it unless you know why it does not apply to your submission.
- **PASS** and **INFO** need no action.

## What it checks

1. **Upload.** The file is a valid ZIP, named `TeamName_Track2.zip`. It is within the size limits. It has no absolute
   paths or `..` paths. Every file reads back intact.
2. **Layout.** The repository root has `README.md`, a `Dockerfile`, and the folders `validate/` and `eval/`, each
   holding code. There is a dependency file. The ZIP has no tool folders (`.git`, `.venv`, `node_modules`, …), and
   any slides file has at most 5 slides. If everything sits in one top-level folder, that folder is treated as the
   root.
3. **Secrets.** The ZIP has no `.env` files or other secrets files, and no API keys in any text or code file. The
   Dockerfile does not copy a `.env` file and does not set `OPENROUTER_API_KEY`.
4. **README sections.** There are headings for "Reported folders", "Pilot results" and "Run in Docker". The pilot
   results give scores and describe the generator changes. There are hand-check notes that mention every reported
   task. There are headings for the rest of the README content Section 5 lists.
5. **Reported folders.** "Reported folders" names exactly one task folder and one results folder, and both exist.
   These are the folders the app offers after upload. The checker warns if the app would preselect a different folder.
6. **`tasks.jsonl`.** The task folder has a file named `tasks.jsonl` with one JSON object per line. Each task has
   `task_id` (unique), `image` (relative to the task folder, and the file exists), `question`, `answer` and
   `answer_type`, which is one of `number`, `integer`, `label`, `multiple_choice` or `sequence`. The answer must match
   its type:
   - a non-integer `number` has exactly one of `tolerance_rel` or `tolerance_abs`, and the question states that
     tolerance;
   - a `multiple_choice` answer is an option letter, and the task has an `options` list;
   - a `sequence` answer is a JSON list.

   The checker also looks for a seed, a generator version, check results and the per-task data JSON.
7. **`responses.csv` / `responses.jsonl`.** The results file has all 10 columns: `model`, `task_id`, `status`,
   `parsed`, `question_type`, `response`, `ref_answer`, `correct`, `finish_reason` and `error`. Each model and task
   has exactly one row, and every `task_id` is in `tasks.jsonl`. The values must be allowed ones:
   - `status` is `ok`, `error` is empty and `finish_reason` is not `length` in every row: all model responses must
     be complete, with no truncation or API error, so any `api_error` or `length` row, or a model missing a row for
     an accepted task, is a failure;
   - `correct` is 1 or 0;
   - `ref_answer` equals the task's `answer`.

   No CSV cell may be too long for the judges' CSV reader. The run config should record temperature 0, `max_tokens`
   and the prompt. The results folder should hold raw responses.
8. **"Run in Docker".** The section has a `docker build` command. It has two `docker run` commands: one rebuilds and
   evaluates the 10 reported tasks, the other builds one fresh task. The commands pass `-e OPENROUTER_API_KEY` and
   mount a volume for the outputs, and the section says how to choose the seed and the model.

## What it does not check

It checks the format only. It does not build your Docker image or run your pipeline. It does not check that the
rebuilt tasks match the submitted ones, and it does not judge whether your tasks are realistic, valid or hard. Before
you submit, run the commands in your README's "Run in Docker" section exactly as written, on a clean checkout.
