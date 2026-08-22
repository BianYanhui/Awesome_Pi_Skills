---
name: lastcall
description: >-
  No silent exits — leave a verifiable handoff before a context-heavy pi session stops.
  Distilled from kimi-lastcall (github.com/kagamiurayama/kimi-lastcall): the agent writes a
  5-section handwritten handoff letter (current state / dead ends / unresolved items / first
  next action / optional context) as a project file, marks it done with a session-bound
  marker, and the next session verifies and picks up. Use when the user asks for a handoff,
  handoff letter, 交接, 交接文档, 会话交接, 把当前进度交接给新会话, wants to switch to a fresh
  session with heavy context, says the session is nearly exhausted / context is running low,
  or before ending a session that has meaningful unfinished work. The skill is fail-open: it
  never traps a session, never blocks a stop, and audit records contain decisions only.
---

# Lastcall — leave a verifiable handoff

**No silent exits.** Before a context-heavy pi session stops, write a **handwritten handoff
letter** into the project (a normal file the next session reads), then mark it done with a
**session-bound marker**. A fresh session verifies the letter exists and picks up from it.

This skill distills [kimi-lastcall](https://github.com/kagamiurayama/kimi-lastcall) (MIT) —
its Relay handoff gate — and adapts it to pi sessions. The controller/web-panel halves are
not ported; the durable, verifiable-handoff core is.

All script paths below are relative to this skill's directory. Resolve them to absolute
paths before running, e.g. `<skill-dir>/scripts/lastcall.py ...`.

## When to use

- The user asks to write a handoff / 交接 / 交接文档 / 会话交接 / "把进度交接给新会话".
- The user is about to start a fresh pi session and current context is heavy (long session,
  lots of history). Offer to leave a handoff first — don't silently let the work vanish.
- A session is ending with meaningful unfinished work and no handoff yet: write one, or if
  the user declines, record a reminder (`remind`) so it is loud, not silent.
- A new session starts in a project that has a `HANDOFF.md`: read it, verify, and begin with
  its **First next action** (section 4).

## Workflow (agent side)

### 1. Write the letter (you write it — handwritten, not a blank template)

```bash
<skill-dir>/scripts/lastcall.py start [-f HANDOFF.md]   # optional; creates the skeleton
```

Then fill the five sections **from this session's real state**:

1. **Current state** — exact branches, files, commands run, decisions made, checkable facts.
2. **Dead ends** — what was tried and failed. If none: `None observed in this session.`
3. **Unresolved items** — unknown / blocked / risky / awaiting decision.
4. **First next action** — one concrete, checkable first move for the next session.
5. **Optional context** — tone, preferences. **Never include secrets or tokens.**

Default handoff file: `./HANDOFF.md` in the project root (override with `-f`).

### 2. Let the user review

The handoff is the user's durable artifact — tell them where it is and let them edit it.
Do not `done` until the letter is complete and the user is OK with it.

### 3. Mark it done (session-bound)

```bash
<skill-dir>/scripts/lastcall.py done [-f HANDOFF.md] [--session <id>]
```

Session id defaults to `$PI_SESSION_ID` (set in pi agent sessions). The marker is bound to
the current session — a fresh session must write its own letter and mark its own done.

### 4. Next session: verify and pick up

```bash
<skill-dir>/scripts/lastcall.py status [--json]
```

- `handoff_ready` + `markers.done` ⇒ verified handoff: read `HANDOFF.md`, start at section 4.
- `handoff_ready` but not done ⇒ the letter exists but the previous session never declared
  it complete; read it, verify against reality, proceed.
- No handoff ⇒ say so plainly; do not pretend prior state is trustworthy.

## CLI reference

```text
lastcall.py template                       print the 5-section template
lastcall.py start [-f FILE] [--force]      write the template into the project
lastcall.py done [-f FILE] [--session ID]  mark the handoff letter complete (session-bound)
lastcall.py status [-f FILE] [--json]      show handoff + marker state (fail-open)
lastcall.py remind [--session ID]          record one handoff reminder (loud after 3)
lastcall.py clear [--session ID]           remove this session's markers (re-ask allowed)
lastcall.py audit [--tail N]               show the audit log (decisions only)
```

## Design rules (inherited from kimi-lastcall)

- **The agent writes the letter.** Nothing auto-generates content; a template-only file is
  "written" but the agent must fill it honestly.
- **Never trap.** Every failure is loud and visible, never blocking: `status` never crashes;
  `done` without a session id prints why; `remind` after 3 records the failure and steps aside.
- **Session-bound markers.** Done markers and reminder counts bind to the session digest, so
  one session's declaration never covers another.
- **Private state.** `~/.local/state/pi-lastcall/` (override `PI_LASTCALL_STATE_DIR`): 0700
  dir, 0600 files, symlinks rejected, atomic writes.
- **Audit = decisions only.** `audit.jsonl` records actions/error classes and session
  digests, never handoff content.

## Notes

- Handoff files live in the project (they are meant to be read by the next session and by
  the user). Markers/audit live in the private state dir.
- Do not write secrets into a handoff — it is a durable file, not session memory.
- The skill is stateless in the agent: everything checkable goes through `lastcall.py status`.
