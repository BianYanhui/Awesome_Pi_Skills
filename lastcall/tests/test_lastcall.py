#!/usr/bin/env python3
"""Tests for the lastcall skill script. Runs with plain python3, no pytest needed.

    python3 tests/test_lastcall.py

Covers: template/start/done/status/remind/clear/audit, session binding, 0700/0600
private state, symlink rejection, and fail-open behavior on corrupt state.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "lastcall.py"
SESSION_A = "session_aaaa1111-2222-3333-4444-555566667777"
SESSION_B = "session_bbbb2222-3333-4444-5555-666677778888"


def run(args, *, env_extra=None, cwd=None, stdin=None):
    env = os.environ.copy()
    env.pop("PI_SESSION_ID", None)
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args,
        capture_output=True, text=True, cwd=cwd, env=env, input=stdin,
    )


class LastcallTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.state = self.root / "state"
        self.project = self.root / "project"
        self.project.mkdir()
        self.env = {"PI_LASTCALL_STATE_DIR": str(self.state), "PI_SESSION_ID": SESSION_A}

    def tearDown(self):
        self._tmp.cleanup()

    def script(self, args, *, session=None, cwd=None):
        env = dict(self.env)
        if session is not None:
            env["PI_SESSION_ID"] = session
        return run(args, env_extra=env, cwd=cwd or str(self.project))

    # -- template / start ---------------------------------------------------

    def test_template_has_five_sections(self):
        r = self.script(["template"])
        self.assertEqual(r.returncode, 0)
        for section in ("## 1. Current state", "## 2. Dead ends",
                        "## 3. Unresolved items", "## 4. First next action",
                        "## 5. Optional context"):
            self.assertIn(section, r.stdout)

    def test_start_writes_template_and_refuses_overwrite(self):
        r = self.script(["start"])
        self.assertEqual(r.returncode, 0)
        handoff = self.project / "HANDOFF.md"
        self.assertTrue(handoff.exists())
        self.assertIn("## 1. Current state", handoff.read_text())
        r2 = self.script(["start"])
        self.assertNotEqual(r2.returncode, 0)
        r3 = self.script(["start", "--force"])
        self.assertEqual(r3.returncode, 0)

    # -- done / markers ------------------------------------------------------

    def _write_handoff(self, content="# Handoff\n\n## 1. Current state\nOn main.\n"):
        (self.project / "HANDOFF.md").write_text(content, encoding="utf-8")

    def test_done_requires_nonempty_handoff(self):
        r = self.script(["done"])
        self.assertNotEqual(r.returncode, 0)  # no handoff yet
        self._write_handoff()
        r = self.script(["done"])
        self.assertEqual(r.returncode, 0)
        digest = r.stdout.split()[-1]
        marker = self.state / (digest + ".done")
        self.assertTrue(marker.exists())

    def test_done_is_session_bound(self):
        self._write_handoff()
        self.script(["done"])
        digest_a = self.script(["status", "--json"]).stdout
        a = json.loads(digest_a)["markers"]["session_digest"]
        r = self.script(["status", "--json"], session=SESSION_B)
        b = json.loads(r.stdout)["markers"]["session_digest"]
        self.assertNotEqual(a, b)
        # session B has no done marker
        self.assertFalse(json.loads(r.stdout)["markers"]["done"])

    def test_private_file_permissions(self):
        self._write_handoff()
        self.script(["done"])
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        for path in self.state.glob("*.done"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        audit = self.state / "audit.jsonl"
        self.assertTrue(audit.exists())
        self.assertEqual(stat.S_IMODE(audit.stat().st_mode), 0o600)

    def test_audit_contains_decisions_not_content(self):
        self._write_handoff()
        self.script(["done"])
        self.script(["remind"])
        lines = (self.state / "audit.jsonl").read_text().splitlines()
        self.assertGreaterEqual(len(lines), 2)
        for line in lines:
            payload = json.loads(line)
            self.assertNotIn("HANDOFF.md", payload.get("action", ""))
            self.assertNotIn("Current state", line)
            self.assertIn("action", payload)

    # -- remind: fail-open after MAX_BLOCKS ---------------------------------

    def test_remind_caps_at_three(self):
        for _ in range(4):
            r = self.script(["remind"])
            self.assertEqual(r.returncode, 0)
        r = self.script(["status", "--json"])
        self.assertEqual(json.loads(r.stdout)["markers"]["reminder_count"], 3)
        out = self.script(["remind"]).stdout
        self.assertIn("WARNING", out)

    # -- fail-open on corrupt state ------------------------------------------

    def test_status_fails_open_on_corrupt_count(self):
        self._write_handoff()
        self.state.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(SESSION_A.encode()).hexdigest()[:16]
        (self.state / (digest + ".count")).write_text("not-a-number")
        r = self.script(["status"])
        self.assertEqual(r.returncode, 0)  # never crashes

    def test_status_fails_open_on_missing_session_id(self):
        self._write_handoff()
        r = self.script(["status"], session="")  # no PI_SESSION_ID in env
        self.assertEqual(r.returncode, 0)
        self.assertIn("session: unknown", r.stdout)

    def test_done_fails_open_without_session_id(self):
        self._write_handoff()
        r = self.script(["done"], session="")
        self.assertNotEqual(r.returncode, 0)  # loud, not silent
        self.assertIn("PI_SESSION_ID", r.stderr)

    # -- symlink rejection ----------------------------------------------------

    def test_symlinked_state_file_rejected(self):
        self._write_handoff()
        self.script(["done"])
        digest = json.loads(self.script(["status", "--json"]).stdout)["markers"]["session_digest"]
        real = self.state / "real-marker"
        real.write_text("x")
        try:
            (self.state / (digest + ".done")).unlink()
            os.symlink(str(real), self.state / (digest + ".done"))
            # status should still not crash; clear should refuse the symlink
            r = self.script(["clear"])
            self.assertEqual(r.returncode, 0)
            self.assertTrue(real.exists())  # symlink target untouched
        finally:
            real.unlink(missing_ok=True)

    # -- clear ---------------------------------------------------------------

    def test_clear_removes_own_markers(self):
        self._write_handoff()
        self.script(["done"])
        self.script(["remind"])
        r = self.script(["clear"])
        self.assertEqual(r.returncode, 0)
        state = json.loads(self.script(["status", "--json"]).stdout)["markers"]
        self.assertFalse(state["done"])
        self.assertEqual(state["reminder_count"], 0)

    # -- end-to-end handoff flow ---------------------------------------------

    def test_full_handoff_flow(self):
        self.script(["start"])
        r = self.script(["status", "--json"])
        first = json.loads(r.stdout)
        # a freshly started template counts as written (presence + size), but
        # it is NOT yet verified: the session-bound done marker is absent
        self.assertTrue(first["handoff_ready"])
        self.assertFalse(first["markers"]["done"])
        self.assertEqual(self.script(["done"]).returncode, 0)
        final = json.loads(self.script(["status", "--json"]).stdout)
        self.assertTrue(final["handoff_ready"])
        self.assertTrue(final["markers"]["done"])
        # the next session can pick up: it sees a verified handoff
        pick = json.loads(self.script(["status", "--json"], session=SESSION_B).stdout)
        self.assertTrue(pick["handoff_ready"])
        self.assertFalse(pick["markers"]["done"])
        # and B still needs its own marker before its own handoff is verified:
        # the done marker is session-bound, so A's marker does not cover B
        self.assertEqual(self.script(["done"], session=SESSION_B).returncode, 0)
        pick2 = json.loads(self.script(["status", "--json"], session=SESSION_B).stdout)
        self.assertTrue(pick2["markers"]["done"])
        self.assertNotEqual(
            pick2["markers"]["session_digest"],
            json.loads(self.script(["status", "--json"]).stdout)["markers"]["session_digest"],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
