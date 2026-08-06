---
name: double-check
description: >-
  Double-check workflow. Use when the user asks to double-check, double check, cross-check, verify,
  cross-review, 复核, 二次检查, 双重检查, or wants an answer checked by a different model before delivery.
  The agent (the current/main model) completes the task, then a DIFFERENT model (preferring the latest:
  MiniMax -> MiniMax-M3, DeepSeek -> deepseek-v4-flash) independently checks the result; on failure the
  main model revises and the loop repeats (max 3 rounds), and the final reply reports which main model and
  check model were used.
---

# Double-Check Skill

Execute this workflow whenever the skill is invoked. **You (the agent executing this skill) ARE the main
model.** All script paths below are relative to this skill's directory (the directory containing this
`SKILL.md` file) — resolve them to absolute paths before running, e.g. `cd "$(dirname SKILL.md)"` or use
`<skill-dir>/scripts/...`.

## 0. Identify the main model

- Read `$PI_MODEL` (e.g. `deepseek-v4-flash`) and `$PI_PROVIDER` (e.g. `deepseek`) from the environment.
- If `$PI_MODEL` is unset, ask the user or infer from `pi --list-models` / current session. Record it for
  the final report.

## 1. Complete the task with the main model

- Do the task normally with your full tools and best effort, exactly as you would without this skill.
- Write your complete, self-contained answer to a temp file **answer.txt** (use `mktemp` and keep the path).
  For code/file tasks, the answer must include the key code, diffs, file paths, and a summary of what was
  done, so the checker can actually review it.
- Write the user's original task (verbatim) to a temp file **task.txt**.

## 2. Pick a check model (must be different from the main model)

- Run: `<skill-dir>/scripts/pick-check-model.sh "$PI_MODEL"`
- It prints the chosen model as `provider/model` on stdout (e.g. `minimax-cn/MiniMax-M3`).
- Selection rules: MUST differ from the main model → prefer a different provider → prefer the provider's
  latest model (**MiniMax → MiniMax-M3**, **DeepSeek → deepseek-v4-flash**) → else any other model.
- If it exits non-zero (no different model available), tell the user transparently that no different model
  is configured, deliver your answer anyway with a warning, and stop. Never fake a check.

## 3. Check the answer with the check model

- Run: `<skill-dir>/scripts/run-check.sh <task.txt> <answer.txt> <check-model>` (optional 4th arg:
  thinking level, default `low` — the checker models are reasoning models and review more reliably
  with thinking on; use `high`/`medium` for the strictest review, `off` for the fastest).
- It prints a single-line JSON verdict:
  `{"verdict":"pass"|"fail","score":0-100,"issues":[...],"suggestions":[...],"explanation":"..."}`
- Save the verdict to `round-<n>.json` for the final report.
- If the command fails or hangs (use a bash timeout of ~300 s), retry once; if it still fails, note the
  check failure and continue with the best answer you have.

## 4. Loop: revise and re-check (max 3 rounds)

```
round = 1
loop:
  verdict = check(answer, round)          # step 3
  if verdict == "pass": break             # step 3 of the requirement -> success
  if round >= 3: break                    # forced exit after 3 failed rounds
  # step 4 of the requirement: feed the check result back to the main model (= you)
  revise answer.txt as the main model, addressing every issue/suggestion from the verdict
  (checker feedback is guidance, not final truth — use your judgment and your tools)
  round += 1
  go to loop
```

- On a `fail`, you MUST visibly revise `answer.txt` (re-read the issues/suggestions and rework the answer),
  then re-run step 3. Do not just resubmit the same answer.
- After the 3rd failed round, force exit the loop and keep the best revised answer.

## 5. Report

Compose the final answer to the user:

1. **Final answer** — the (possibly revised) best answer.
2. **Double-Check Report** (short, at the end):
   - **Main model**: `<provider>/<model>` (from `$PI_PROVIDER` / `$PI_MODEL`)
   - **Check model**: `<provider>/<model>` (the one actually used)
   - **Rounds**: N / 3, with per-round summary: round → `pass`/`fail` → top issues (if any)
   - **Status**: "✅ passed check" / "⚠️ forced exit after 3 failed rounds — unverified, remaining issues: …"

Be transparent: never claim a check passed when it did not. If the loop was forced out, clearly mark the
result as unverified and list the remaining issues.

## Example

```bash
SKILL_DIR=<absolute path to this skill directory>
task=$(mktemp -t dc-task.XXXXXX); answer=$(mktemp -t dc-answer.XXXXXX)
# (write the user's task into $task, your answer into $answer)
CHECK_MODEL=$("$SKILL_DIR/scripts/pick-check-model.sh" "$PI_MODEL")
"$SKILL_DIR/scripts/run-check.sh" "$task" "$answer" "$CHECK_MODEL"
```
