# Awesome_Pi_Skills development

Guidelines for agents and humans working on this repository.

## Project layout

- `package.json` — pi package manifest: registers the extension (`./extensions`) and the
  skills (`./double-check`, `./iconfont-search`). Installable with
  `pi install git:github.com/BianYanhui/Awesome_Pi_Skills@main`.
- `extensions/index.ts` — extension entry point (ported from OpenAI Codex): registers the
  `/goal`, `/btw`, `/review`, `/diff`, `/plan` commands and `goal_*` tools.
- `src/goal/` — `/goal` command and `goal_*` tools (state machine, formatting, persistence).
- `src/btw.ts` — `/btw` side-conversation support.
- `src/review.ts` — `/review` command.
- `src/diff.ts` — `/diff` command.
- `src/plan.ts` — `/plan` plan-mode toggle.
- `double-check/` — skill: task → different-model check → revise loop (max 3) → report.
- `iconfont-search/` — skill: search & download SVG icons from iconfont.cn (no login).
- `tests/` — `node:test` + `tsx` test suite. `tests/helpers.ts` loads the extension
  through Pi's own `loadExtensions` and provides a mock `ctx`.

## Commands

- `npm install` — install dev dependencies.
- `npm test` — run the whole test suite (extension commands + tools).
- `npm run verify:pi` — load the extension with the real `pi` binary (no session).
- `npm run pack:dry-run` — check the published file set.

## Conventions

- Target files under ~500 LoC; prefer new modules over growing existing ones.
- Keep the goal state machine in `src/goal/state.ts`; formatting helpers in
  `src/goal/format.ts`; persistence/entry helpers near the state.
- Tests: prefer deep-equality assertions on whole objects; use the harness in
  `tests/helpers.ts` rather than testing internals directly.
- Never add `CODEX_SANDBOX_*` related code (not relevant here, but be aware
  the upstream Codex repo forbids touching it).
- When changing the goal entry schema, bump `version` in the persisted entry.
- Skills: each skill is a self-contained directory with `SKILL.md` (frontmatter `name` +
  `description`), optional `scripts/` and `README.md`. Keep paths in `SKILL.md` relative
  to the skill directory.
- Licenses: repo root and skills are MIT; the extension code (`extensions/`, `src/`, `tests/`)
  is Apache-2.0 (derived from OpenAI Codex) — see `LICENSE-APACHE-2.0`.

## Goal design notes

The goal state machine mirrors Codex's `ThreadGoalStatus`:
`active | paused | blocked | budget_limited | complete`.

Unlike the pi-goal package it replaces, `/goal <objective>` activates a goal
immediately — no setup interview or contract dance. Agents interact with the
goal through the `goal_get`, `goal_status_line`, and `goal_complete` tools.

## Side-conversation design notes

`/btw` opens a forked session page. `/btw <question>` asks the question there.
`/btw-return` (or `/resume`) switches back; the active goal stays active across
the switch and resumes continuation on return.
