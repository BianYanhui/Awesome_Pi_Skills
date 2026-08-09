# Pi_from_Codex development

Guidelines for agents and humans working on this repository.

## Project layout

- `extensions/index.ts` — the extension entry point; registers commands and tools.
- `src/goal/` — `/goal` command and `goal_*` tools (state machine, formatting, persistence).
- `src/btw.ts` — `/btw` side-conversation support.
- `src/review.ts` — `/review` command.
- `src/diff.ts` — `/diff` command.
- `src/plan.ts` — `/plan` plan-mode toggle.
- `tests/` — `node:test` + `tsx` test suite. `tests/helpers.ts` loads the extension
  through Pi's own `loadExtensions` and provides a mock `ctx`.

## Commands

- `npm install` — install dev dependencies.
- `npm test` — run the whole test suite.
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

## Goal design notes

The goal state machine mirrors Codex's `ThreadGoalStatus`:
`active | paused | blocked | budget_limited | complete`.

Unlike the pi-goal package it replaces, `/goal <objective>` activates a goal
immediately — no setup interview or contract dance. Agents interact with the
goal through `goal_get`, `goal_status_line`, and `goal_complete` tools.

Once active, the extension drives autonomous continuation: after the agent
settles, it queues a follow-up turn to keep working toward the objective.
Continuation stops when the agent asks the user a question, the user has
pending input, a continuation turn does no work, the token budget is hit, the
goal is completed, or the goal is paused/cleared.
