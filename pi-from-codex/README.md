# Pi_from_Codex

Slash commands for [Pi](https://github.com/badlogic/pi-agent), ported from [OpenAI Codex](https://github.com/openai/codex).

This package registers five slash commands plus goal tools that mirror the
behavior of Codex's built-in commands:

| Command | Codex source | What it does |
|---------|--------------|--------------|
| `/goal` | `codex-rs/tui/src/goal_display.rs` | Set, inspect, pause, resume, edit, or clear a long-running session goal |
| `/btw`  | `codex-rs/tui/src/chatwidget/side.rs` | Start a side conversation in a fork of the current session |
| `/review` | `codex-rs/skills/src/assets/samples/review-agent/SKILL.md` | Review the current working-tree changes |
| `/diff` | Codex `/diff` command | Show the git diff, including untracked files |
| `/plan` | Codex `/plan` command | Switch to plan mode: analyze first, do not modify files |

## Install

```bash
pi install git:github.com/BianYanhui/Pi_from_Codex@main
```

Try without installing:

```bash
pi -e git:github.com/BianYanhui/Pi_from_Codex
```

## Commands

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

After you set a goal, Pi keeps working on it automatically: when the agent
settles, it queues a follow-up turn toward the objective. Continuation stops
when the agent asks you a question, you type something, a continuation turn
finds no work, the token budget is hit, the goal is completed, or you
pause/clear it.

Agent tools (registered for the model):

- `goal_get` — inspect current goal state
- `goal_status_line` — update the short progress line shown in the status bar
- `goal_complete` — mark the goal complete when actually achieved

### `/btw [question]`

Start a side conversation — Codex's empty side fork. `/btw` switches to a
clean **new page** (a new session that does not copy the parent branch);
`/btw <question>` additionally asks the question there. The parent session
file is recorded so `/btw-return` (or `/resume`) switches back at any time.

The main session's active goal stays **active** across the switch; returning
to the main session automatically resumes goal continuation.

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

## License

Apache-2.0. Portions derived from OpenAI Codex (Apache-2.0) and pi-goal
concepts (MIT). See LICENSE.
