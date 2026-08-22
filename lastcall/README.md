# lastcall

**No silent exits — leave a verifiable handoff.** A pi skill distilled from
[kimi-lastcall](https://github.com/kagamiurayama/kimi-lastcall) (MIT, by kagamiurayama):
before a context-heavy pi session stops, the agent writes a 5-section handwritten handoff
letter into the project and marks it done with a session-bound marker; the next session
verifies and picks up from it.

## Triggers

- 「写个交接」「交接文档」「会话交接」「把当前进度交接给新会话」
- "write a handoff / handover letter", "hand off to a new session"
- Switching to a fresh session with heavy context; session ending with unfinished work.

## What it does

- `start` — writes the 5-section skeleton (`HANDOFF.md` by default):
  1. Current state · 2. Dead ends · 3. Unresolved items · 4. First next action · 5. Optional context
- `done` — verifies the letter exists/non-empty, then writes a **session-bound** done marker
  (keyed by `$PI_SESSION_ID` digest) under `~/.local/state/pi-lastcall/`
- `status --json` — machine-readable handoff + marker state for the agent (fail-open)
- `remind` — records a handoff reminder; after 3 it is loud and steps aside (never traps)
- `clear` — removes the current session's markers (re-ask allowed)
- `audit` — decisions/error classes only, never handoff content

## Usage

```bash
scripts/lastcall.py start                     # create ./HANDOFF.md skeleton
scripts/lastcall.py done                      # mark complete (session-bound)
scripts/lastcall.py status --json             # verify state, machine-readable
scripts/lastcall.py template                  # print the template
```

## Design (inherited from kimi-lastcall)

- The agent **writes** the letter; nothing fabricates content.
- **Fail-open**: no error can trap a session — status never crashes, reminders cap at 3.
- **Session-bound markers**: one session's done never covers another.
- **Private state**: 0700 dir / 0600 files / no symlinks / atomic writes.
- **Audit = decisions only**, identified by irreversible session digests.

## Tests

```bash
python3 tests/test_lastcall.py    # stdlib unittest, no dependencies
```

13 tests cover template/start/done/status/remind/clear/audit, session binding, permission
bits, symlink rejection, corrupt-state fail-open, and a full handoff→pickup flow.

## License

MIT. The design is distilled from [kimi-lastcall](https://github.com/kagamiurayama/kimi-lastcall)
(MIT, © kagamiurayama); see its LICENSE for the original.
