#!/usr/bin/env python3
"""lastcall.py — pi session handoff ("no silent exits").

Distilled from kimi-lastcall (https://github.com/kagamiurayama/kimi-lastcall, MIT):
the Relay handoff gate's essential ideas, adapted to pi sessions:

  - The agent (or human) writes a 5-section handwritten handoff letter before a
    context-heavy session stops; the handoff is a project file, not a summary
    buried in the session.
  - A session-bound done marker records that THIS session finished its letter,
    so a fresh session knows whether a verified handoff exists.
  - Fail-open: no parse error or unreadable state may trap the user. Status
    reports warnings; nothing here ever blocks or crashes a live session.
  - Private state: 0700 dir, 0600 files, no symlinks, atomic writes, and an
    audit log that records decisions/error classes only — never handoff content.

Standard library only. State lives in ~/.local/state/pi-lastcall/ (override with
PI_LASTCALL_STATE_DIR). Session identity comes from PI_SESSION_ID (pi agent env),
or --session.

Usage:
  lastcall.py template                     print the 5-section handoff template
  lastcall.py start [-f HANDOFF.md] [--force]   write the template into the project
  lastcall.py done [-f HANDOFF.md] [--session ID]   mark the handoff letter complete
  lastcall.py status [-f HANDOFF.md] [--json]  show handoff + marker state (fail-open)
  lastcall.py clear [--session ID]        remove this session's markers (re-ask allowed)
  lastcall.py audit [--tail N]            show the audit log (decisions only)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import stat
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

APP_NAME = "pi-lastcall"
ENV_STATE_DIR = "PI_LASTCALL_STATE_DIR"
ENV_SESSION_ID = "PI_SESSION_ID"

DEFAULT_HANDOFF = "HANDOFF.md"
AUDIT_FILENAME = "audit.jsonl"
MAX_BLOCKS = 3  # how many times status may "remind" a session before giving up loudly

TEMPLATE = """# Handoff

<!-- pi-lastcall: 5-section handwritten handoff. Fill every section before stopping. -->

## 1. Current state

<!-- What is true now? Include exact branches, files, commands, decisions, or other
     checkable state when relevant. -->

## 2. Dead ends

<!-- What was tried and did not work? If none: None observed in this session. -->

## 3. Unresolved items

<!-- What remains unknown, blocked, risky, or awaiting a decision? -->

## 4. First next action

<!-- Give the next session one concrete first move. -->

## 5. Optional context

<!-- Tone, preferences, or collaboration context worth preserving. Do not include secrets. -->
"""


# ---------------------------------------------------------------------------
# private state (0700 dir / 0600 files / no symlinks / atomic writes)
# ---------------------------------------------------------------------------

class StateError(RuntimeError):
    pass


def state_dir() -> Path:
    override = os.environ.get(ENV_STATE_DIR)
    if override:
        return Path(override).expanduser()
    base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
    return base / APP_NAME


def ensure_private_dir(path: Path) -> Path:
    path = path.expanduser()
    try:
        info = path.lstat()
    except FileNotFoundError:
        path.mkdir(parents=True, mode=0o700)
        os.chmod(str(path), 0o700)
        info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise StateError("state_dir_invalid")
    if info.st_uid != os.geteuid():
        raise StateError("state_dir_owner_invalid")
    if stat.S_IMODE(info.st_mode) != 0o700:
        raise StateError("state_dir_mode_invalid")
    return path


def validate_private_file(path: Path) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise StateError("state_file_unreadable") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise StateError("state_file_invalid")
    if info.st_uid != os.geteuid():
        raise StateError("state_file_owner_invalid")
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise StateError("state_file_mode_invalid")
    return info


def atomic_write_private(path: Path, text: str) -> None:
    parent = ensure_private_dir(path.parent)
    temporary = parent / (".%s.%s.tmp" % (path.name, secrets.token_hex(8)))
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(str(temporary), flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
        os.chmod(str(path), 0o600)
        _fsync_dir(parent)
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# session identity + markers
# ---------------------------------------------------------------------------

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def resolve_session_id(arg: Optional[str]) -> str:
    value = (arg or os.environ.get(ENV_SESSION_ID) or "").strip()
    if not value or SESSION_ID_RE.fullmatch(value) is None:
        raise StateError("session_id_missing")
    return value


def session_digest(session_id: str) -> str:
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:16]


def marker_path(session_id: str) -> Path:
    return state_dir() / (session_digest(session_id) + ".done")


def count_path(session_id: str) -> Path:
    return state_dir() / (session_digest(session_id) + ".count")


def audit_path() -> Path:
    return state_dir() / AUDIT_FILENAME


def audit(record: Dict[str, Any], session_id: Optional[str] = None) -> None:
    """Append one decision/error-class record.  Never raises, never contains content."""
    try:
        entry = dict(record)
        entry["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if session_id:
            entry["session"] = session_digest(session_id)
        path = audit_path()
        ensure_private_dir(path.parent)
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(str(path), flags, 0o600)
        try:
            with os.fdopen(fd, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
            os.chmod(str(path), 0o600)
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
    except OSError:
        pass


def read_count(session_id: str) -> int:
    """Fail-open: corrupt/unreadable counters behave like 'never triggered'."""
    try:
        raw = count_path(session_id).read_text(encoding="utf-8").strip()
        value = int(raw)
        return value if 0 <= value <= MAX_BLOCKS else 0
    except (OSError, ValueError):
        return 0


def write_count(session_id: str, value: int) -> None:
    try:
        atomic_write_private(count_path(session_id), str(value) + "\n")
    except StateError:
        pass


def _bump_reminder(session_id: str) -> int:
    """Count how many times this session was reminded to write the handoff."""
    value = read_count(session_id)
    if value < MAX_BLOCKS:
        write_count(session_id, value + 1)
    return min(value + 1, MAX_BLOCKS)


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_template(_args: argparse.Namespace) -> int:
    sys.stdout.write(TEMPLATE)
    return 0


def _handoff_path(args: argparse.Namespace) -> Path:
    raw = getattr(args, "file", None) or DEFAULT_HANDOFF
    path = Path(raw).expanduser()
    return path if path.is_absolute() else Path.cwd() / path


def cmd_start(args: argparse.Namespace) -> int:
    path = _handoff_path(args)
    if path.exists() and not args.force:
        print(
            "lastcall: %s already exists (use --force to overwrite, or edit in place)"
            % path,
            file=sys.stderr,
        )
        return 1
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(TEMPLATE, encoding="utf-8")
    except OSError as exc:
        print("lastcall: cannot write %s: %s" % (path, exc), file=sys.stderr)
        return 1
    print("lastcall: handoff template written to %s" % path)
    print("Fill the 5 sections, then: lastcall.py done")
    return 0


def _handoff_status(path: Path) -> Dict[str, Any]:
    result: Dict[str, Any] = {"path": str(path), "exists": False, "valid": False, "size": 0}
    try:
        info = path.lstat()
    except FileNotFoundError:
        return result
    except OSError:
        result["reason"] = "unreadable"
        return result
    result["exists"] = True
    result["size"] = int(info.st_size)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        result["reason"] = "not_regular"
    elif info.st_uid != os.geteuid():
        result["reason"] = "owner_mismatch"
    else:
        result["valid"] = True
    return result


def cmd_done(args: argparse.Namespace) -> int:
    path = _handoff_path(args)
    status = _handoff_status(path)
    if not status["valid"] or status["size"] == 0:
        reason = status.get("reason") or "empty"
        print(
            "lastcall: handoff not ready (%s): %s — write the letter first" % (reason, path),
            file=sys.stderr,
        )
        audit({"action": "done_rejected", "reason": reason})
        return 1
    try:
        session_id = resolve_session_id(args.session)
    except StateError as exc:
        print("lastcall: %s (set PI_SESSION_ID or pass --session)" % exc, file=sys.stderr)
        return 1
    try:
        atomic_write_private(marker_path(session_id), "done\n")
    except StateError as exc:
        print("lastcall: cannot write marker: %s" % exc, file=sys.stderr)
        return 1
    audit({"action": "handoff_done", "bytes": status["size"]}, session_id)
    print("lastcall: handoff marked complete for session %s" % session_digest(session_id))
    return 0


def cmd_remind(args: argparse.Namespace) -> int:
    """Record that this session was asked to write its handoff (never traps).

    The original kimi-lastcall blocks a Stop at most MAX_BLOCKS times, then
    steps aside loudly.  Here the agent calls this before stopping without a
    handoff; status reports the count so the agent knows when to stop asking.
    """
    try:
        session_id = resolve_session_id(args.session)
    except StateError as exc:
        print("lastcall: %s" % exc, file=sys.stderr)
        return 1
    count = _bump_reminder(session_id)
    audit({"action": "remind", "count": count}, session_id)
    print("lastcall: reminder %d/%d for session %s" % (
        count, MAX_BLOCKS, session_digest(session_id)))
    if count >= MAX_BLOCKS:
        print("lastcall: WARNING: reminded %d times; step aside and proceed "
              "without a verified handoff (fail-open)" % MAX_BLOCKS)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    path = _handoff_path(args)
    handoff = _handoff_status(path)
    markers: Dict[str, Any] = {"done": False}
    warning: Optional[str] = None
    try:
        session_id = resolve_session_id(args.session)
        markers["session_digest"] = session_digest(session_id)
        markers["done"] = marker_path(session_id).exists()
        markers["reminder_count"] = read_count(session_id)
    except StateError as exc:
        warning = str(exc)
    result = {
        "schema": "pi_lastcall.status.v1",
        "handoff": handoff,
        "handoff_ready": bool(handoff["valid"] and handoff["size"] > 0),
        "markers": markers,
        "warning": warning,
        "state_dir": str(state_dir()),
    }
    if getattr(args, "json", False):
        sys.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
    else:
        state_txt = "ready" if result["handoff_ready"] else (
            "missing" if not handoff["exists"] else "needs content")
        print("handoff: %s (%s)" % (path, state_txt))
        if handoff.get("reason"):
            print("  reason: %s" % handoff["reason"])
        if warning:
            print("session: unknown (%s)" % warning)
        else:
            print("session digest: %s" % markers["session_digest"])
            print("done marker: %s" % ("yes" if markers["done"] else "no"))
            print("reminder count: %d/%d" % (markers["reminder_count"], MAX_BLOCKS))
        if result["handoff_ready"] and markers.get("done"):
            print("=> verified handoff: the next session can pick up from this letter")
        if result["handoff_ready"] and not markers.get("done"):
            print("=> handoff written but not marked done: run `lastcall.py done`")
        if not result["handoff_ready"] and markers.get("reminder_count", 0) >= MAX_BLOCKS:
            print("=> WARNING: reminded %d times; continuing without a verified handoff is on you" % MAX_BLOCKS)
        if warning:
            print("note: %s" % warning)
    return 0


def cmd_clear(args: argparse.Namespace) -> int:
    try:
        session_id = resolve_session_id(args.session)
    except StateError as exc:
        print("lastcall: %s" % exc, file=sys.stderr)
        return 1
    removed = []
    for path in (marker_path(session_id), count_path(session_id)):
        try:
            if path.exists() or path.is_symlink():
                validate_private_file(path)
                path.unlink()
                removed.append(path.name)
        except (OSError, StateError):
            pass
    audit({"action": "markers_cleared", "files": removed}, session_id)
    print("lastcall: cleared markers for session %s: %s" % (
        session_digest(session_id), ", ".join(removed) if removed else "none"))
    return 0


def cmd_audit(args: argparse.Namespace) -> int:
    try:
        lines = audit_path().read_text(encoding="utf-8").splitlines()
    except OSError:
        print("lastcall: no audit log yet")
        return 0
    tail = lines[-max(0, args.tail):]
    for line in tail:
        print(line)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lastcall", description="No silent exits. Leave a verifiable handoff.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("template", help="print the 5-section handoff template").set_defaults(handler=cmd_template)

    p = sub.add_parser("start", help="write the handoff template into the project")
    p.add_argument("-f", "--file", default=DEFAULT_HANDOFF, help="handoff path (default: ./%s)" % DEFAULT_HANDOFF)
    p.add_argument("--force", action="store_true", help="overwrite an existing handoff file")
    p.set_defaults(handler=cmd_start)

    p = sub.add_parser("done", help="mark the handoff letter complete (session-bound)")
    p.add_argument("-f", "--file", default=DEFAULT_HANDOFF)
    p.add_argument("--session", default=None, help="session id (default: $PI_SESSION_ID)")
    p.set_defaults(handler=cmd_done)

    p = sub.add_parser("status", help="show handoff + marker state (fail-open)")
    p.add_argument("-f", "--file", default=DEFAULT_HANDOFF)
    p.add_argument("--session", default=None)
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.set_defaults(handler=cmd_status)

    p = sub.add_parser("clear", help="remove this session's markers (re-ask allowed)")
    p.add_argument("--session", default=None)
    p.set_defaults(handler=cmd_clear)

    p = sub.add_parser("remind", help="record one handoff reminder (fail-open after %d)" % MAX_BLOCKS)
    p.add_argument("--session", default=None)
    p.set_defaults(handler=cmd_remind)

    p = sub.add_parser("audit", help="show audit log (decisions only)")
    p.add_argument("--tail", type=int, default=20)
    p.set_defaults(handler=cmd_audit)

    return parser


def main(argv: Optional[list] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
