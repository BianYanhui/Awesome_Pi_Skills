# Awesome_Pi_Skills

A curated collection of [pi](https://github.com/earendil-works/pi) agent skills **plus**
slash commands ported from [OpenAI Codex](https://github.com/openai/codex) — all in one
installable pi package.

## Install everything in one shot

```bash
pi install git:github.com/BianYanhui/Awesome_Pi_Skills@main
```

This registers the extension (`/goal`, `/btw`, `/review`, `/diff`, `/plan` + `goal_*` tools)
**and** both skills. Try without installing:

```bash
pi -e git:github.com/BianYanhui/Awesome_Pi_Skills
```

## Skills

| Skill | Description |
|-------|-------------|
| [double-check](double-check/README.md) | Completes your task with the current (main) model, then has a **different** model (preferring the latest: MiniMax → MiniMax-M3, DeepSeek → deepseek-v4-flash) independently check the result; revises and re-checks on failure (max 3 rounds), and reports which main/check models were used. |
| [iconfont-search](iconfont-search/README.md) | Search and download clean standalone SVG icons from iconfont.cn (阿里巴巴矢量图标库) via its public API — no login needed. Auto-triggers on requests like「图标从 iconfont 里面自己搜」/ "search icons on iconfont". Supports multi-keyword, sort by heat/name/date, HTML preview grid. |

### Installing a skill standalone

```bash
# symlink (recommended — updates follow the repo)
ln -s "$PWD/double-check" ~/.agents/skills/double-check
ln -s "$PWD/iconfont-search" ~/.agents/skills/iconfont-search

# or copy
cp -r double-check ~/.agents/skills/
```

Then use it in pi by mentioning it (e.g. "用 double-check 检查一下…", "图标从 iconfont 里面自己搜")
or via `/skill:double-check <task>`.

## Slash commands (ported from Codex)

| Command | Codex source | What it does |
|---------|--------------|--------------|
| `/goal` | `codex-rs/tui/src/goal_display.rs` | Set, inspect, pause, resume, edit, or clear a long-running session goal |
| `/btw`  | `codex-rs/tui/src/chatwidget/side.rs` | Start a side conversation in a fork of the current session |
| `/review` | `codex-rs/skills/src/assets/samples/review-agent/SKILL.md` | Review the current working-tree changes |
| `/diff` | Codex `/diff` command | Show the git diff, including untracked files |
| `/plan` | Codex `/plan` command | Switch to plan mode: analyze first, do not modify files |

### `/goal`

Long-running session goal with autonomous continuation, status tracking, time
accounting, and an optional token budget. Mirrors Codex's goal model
(`ThreadGoalStatus`: `active`, `paused`, `blocked`, `budget_limited`, `complete`).

```text
/goal <objective>            Set and activate a goal (optionally: --token-budget <n>)
/goal status                 Show the current goal
/goal edit <objective>       Replace the objective of the active goal
/goal budget <n>             Set (or clear with 0) the token budget
/goal pause                  Pause autonomous continuation
/goal resume                 Resume a paused goal
/goal clear                  Clear the goal and any setup state
/goal help                   Show usage
```

Agent tools (registered for the model):

- `goal_get` — inspect current goal state
- `goal_status_line` — update the short progress line shown in the status bar
- `goal_complete` — mark the goal complete when actually achieved

### `/btw [question]`

Start a side conversation — Codex's empty side fork. `/btw` switches to a
clean **new page** (a new session that does not copy the parent branch);
`/btw <question>` additionally asks the question there. The parent session
file is recorded so `/btw-return` (or `/resume`) switches back at any time.
The main session's active goal stays **active** across the switch.

### `/review`

Review the current git working-tree changes (staged + unstaged + untracked).
Injects a review task into the current session with the collected diff.

### `/diff [--cached] [--stat] [path...]`

Show the git diff in a pager/editor. Includes untracked files by default.

### `/plan [on|off]`

Toggle plan mode. While active, Pi is instructed to analyze and produce a plan
before making any changes, and to wait for user confirmation.

## Development

```bash
npm install          # install dev dependencies
npm test             # run the test suite (node:test + tsx)
npm run verify:pi    # smoke-test extension loading with pi itself
```

See [AGENTS.md](AGENTS.md) for layout and conventions.

## License

- Repo root, skills, and this README: [MIT](LICENSE).
- Extension code (`extensions/`, `src/`, `tests/`, `docs/`): [Apache-2.0](LICENSE-APACHE-2.0),
  portions derived from OpenAI Codex (Apache-2.0) and pi-goal concepts (MIT).
