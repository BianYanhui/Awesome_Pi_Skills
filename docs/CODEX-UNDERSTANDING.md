# Understanding OpenAI Codex CLI (study notes)

Notes from reading the `openai/codex` repository (main, commit 2b5bdcf6).
These notes informed the design of the commands in this package.

## Repository layout

```
codex-cli/          npm/JS: installers, desktop app shell
codex-rs/           Rust workspace, ~120 crates, ~2,800 source files
  cli/              entry point: multi-command clap CLI (exec/review/login/mcp/plugin/app-server/sandbox/resume/archive/fork...)
  core/             the agent: sessions, turns, tools, context, compaction
  tui/              ratatui terminal UI
  exec/             non-interactive `codex exec` (CI-friendly, JSON events)
  protocol/         protocol types (Event, Op, Items, thread ids, permissions)
  app-server/       JSON-RPC server used by IDEs (VSCode etc.)
  exec-server/      remote/exec service for sandboxed execution
  sandboxing/       Seatbelt (macOS), Landlock/bwrap (Linux), RestrictedToken (Windows)
  mcp-server/       Codex as an MCP server over stdio
  skills/, core-skills/, ext/skills/   skill system (Agent Skills standard)
  ...               login, config, connectors, plugins, hooks, rollout, analytics...
```

## Agent loop (`core/src/session/turn.rs`)

`run_turn()` is the heart:

1. **Pre-sampling compaction** — if the thread would overflow the context
   window, compact *before* recording the new input.
2. **Capture step context** — model, environment snapshot, MCP servers,
   skills/plugins to inject, permission profile.
3. **Record context updates** — the model-visible state is built up
   incrementally (never rewritten).
4. **Sampling loop** — stream a Responses API request (`client.rs`), then for
   each `OutputItemDone`: function call → execute tool → append result and
   sample again; assistant message → turn complete.
5. **Post-sampling** — token accounting, auto-compact or context-window
   roll-over when the limit is hit, pending-input drain, follow-up turns.

Key invariants (from AGENTS.md):

- Model context is incremental, bounded, hard-capped; no item > 10K tokens.
- Everything injected into model context is a `ContextualUserFragment`
  struct in `core/context`.
- A `ModelClientSession` is created **per turn**; it owns the WebSocket
  connection and the `x-codex-turn-state` sticky-routing token, which must
  not leak across turns.

## Context fragments (`context/` + `codex-rs/context-fragments`)

`ContextualUserFragment` trait (`context-fragments/src/fragment.rs`):

```rust
fn role(&self) -> &'static str;
fn requires_separate_message(&self) -> bool;   // default false
fn markers(&self) -> (&'static str, &'static str); // start/end tags
fn body(&self) -> String;
```

Markers let later code recognize injected fragments. Fragments include:
current-time reminders, permission/plugin/apps instructions, model-switch
warnings, inter-agent messages, realtime instructions, token-budget context,
and the world-state snapshots.

## Model client (`core/src/client.rs`)

- `ModelClient` — provider info, capabilities, static/unary helpers.
- `ModelClientSession` — per-turn streaming session. Lazy WebSocket connect,
  sticky routing via `x-codex-turn-state` header (received at turn start,
  replayed for every request in the turn), HTTP fallback, retries with
  backoff, and turn metadata headers.

## Compaction (`core/src/compact.rs`)

Compaction replaces history with a summary (with a `SUMMARY_PREFIX`
marker). Phases: pre-turn, mid-turn, on context-limit; hooks
(`pre_compact`/`post_compact`) can veto or customize. `CompactTokenBudget`
and window tracking decide when to compact vs. roll over.

## Tool execution (`core/src/exec.rs` + `sandboxing/`)

- `execute_exec_request` → `ExecParams` → spawn under the configured sandbox
  → capture stdout/stderr pipes → honor expiration (timeout/cancel), Ctrl+C
  process-group kill, network policy (proxy env).
- Sandboxes: macOS Seatbelt `.sbpl` policies, Linux Landlock/bwrap, Windows
  restricted token with its own filesystem policy.

## Slash commands / TUI (`tui/src`)

- `slash_command.rs` — ~50 built-in commands with popup ordering and
  descriptions; `/goal`, `/btw`/`/side`, `/plan`, `/review`, `/diff` are the
  ones ported here.
- `chatwidget/side.rs` + `app/side.rs` — side conversations: an **empty
  fork** plus a "Side conversation boundary" developer instruction that makes
  inherited history reference-only; ephemeral, discarded on navigation.
- `goal_display.rs` — `ThreadGoalStatus` (active/paused/blocked/
  usage_limited/budget_limited/complete), compact duration/token formatting.
- `review-agent` skill — defect-first review methodology (P0–P3), the basis
  for `/review` here.

## App server protocol

`app-server-protocol` — JSON-RPC over stdio/ws; v1 legacy + v2 active;
threads, goals, events (`rawResponseItem/*`), TS bindings generated via
`#[ts(export_to)]`; snake_case config payloads, camelCase everywhere else.

## Skills & plugins

- Skills follow the Agent Skills standard (`SKILL.md` with frontmatter:
  name, description, metadata, allowed-tools). Loaded from codex home,
  `.codex/skills`, plugins; injected with mention counts and env-var guards.
- Plugins bundle skills, MCP connectors, and hooks; markets, install/update
  via `codex plugin` CLI.

## What we ported and why

- `/goal` — Codex's status model + display formatting, with autonomous
  continuation (not in Codex's app-server goal; pi-goal had it and users
  expect it).
- `/btw` — Codex's *empty* side fork + return; implemented with
  `ctx.newSession()` + parent-session marker.
- `/review` — the review-agent skill methodology applied to the working-tree
  diff.
- `/diff` — Codex's `/diff` including untracked files.
- `/plan` — Codex's plan mode (analyze first, no mutations).
