# Awesome_Pi_Skills

A collection of [pi](https://github.com/earendil-works/pi) skills.

## double-check

A skill that makes the current (main) model complete a task, then has a **different** model
(preferring the latest: **MiniMax → MiniMax-M3**, **DeepSeek → deepseek-v4-flash**) independently
check the result. If the check fails, the main model revises and the loop repeats (max 3 rounds).
The final reply reports which main model and check model were used.

### Install

```bash
# symlink or copy into a global skills directory
ln -s "$PWD/double-check" ~/.agents/skills/double-check
# or: cp -r double-check ~/.agents/skills/
```

### Usage

- Ask the agent to use it: "用 double-check 检查一下…" / "double-check this answer"
- Or force it: `/skill:double-check <your task>`

### How it works

1. The agent (= main model) completes the task and writes `task.txt` + `answer.txt`.
2. `scripts/pick-check-model.sh` picks a checker model different from the main model
   (different provider first, then provider-preferred latest model).
3. `scripts/run-check.sh` spawns the checker as a clean sub-agent via `pi -p --no-session --no-tools`,
   which returns a strict JSON verdict `{"verdict":"pass"|"fail", ...}`.
4. On `fail`, the main model revises the answer and re-checks — up to 3 rounds, then forces exit.
5. The final answer includes a Double-Check Report (main model, check model, rounds, status).
