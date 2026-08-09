// Integration tests for /diff and /review, using a real temporary git repo.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectDiff, renderUntracked, untrackedPaths } from "../src/git.js";
import { createHarness } from "./helpers.js";

function makeRepo(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "pi-from-codex-test-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	writeFileSync(join(dir, "file.txt"), "hello\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("collectDiff reports no changes on a clean repo", () => {
	const repo = makeRepo();
	try {
		const { diff, untracked, error } = collectDiff(repo.dir);
		assert.equal(error, null);
		assert.equal(diff, "");
		assert.deepEqual(untracked, []);
	} finally {
		repo.cleanup();
	}
});

test("collectDiff captures modified and untracked files", () => {
	const repo = makeRepo();
	try {
		writeFileSync(join(repo.dir, "file.txt"), "hello world\n");
		writeFileSync(join(repo.dir, "new.txt"), "fresh\n");
		const { diff, untracked } = collectDiff(repo.dir);
		assert.match(diff, /file\.txt/);
		assert.deepEqual(untracked, ["new.txt"]);
	} finally {
		repo.cleanup();
	}
});

test("collectDiff --cached captures staged changes only", () => {
	const repo = makeRepo();
	try {
		writeFileSync(join(repo.dir, "file.txt"), "staged change\n");
		writeFileSync(join(repo.dir, "new.txt"), "fresh\n");
		execFileSync("git", ["add", "file.txt"], { cwd: repo.dir });
		const { diff, untracked } = collectDiff(repo.dir, { cached: true });
		assert.match(diff, /file\.txt/);
		assert.deepEqual(untracked, []);
	} finally {
		repo.cleanup();
	}
});

test("collectDiff errors outside a git repo", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-from-codex-norepo-"));
	try {
		const { error } = collectDiff(dir);
		assert.ok(error && error.includes("git"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("untrackedPaths lists untracked files", () => {
	const repo = makeRepo();
	try {
		writeFileSync(join(repo.dir, "a.txt"), "a\n");
		writeFileSync(join(repo.dir, "b.txt"), "b\n");
		assert.deepEqual(untrackedPaths(repo.dir).sort(), ["a.txt", "b.txt"]);
	} finally {
		repo.cleanup();
	}
});

test("renderUntracked renders file contents as pseudo-diffs", () => {
	const repo = makeRepo();
	try {
		writeFileSync(join(repo.dir, "new.txt"), "line1\nline2\n");
		const { text, truncated } = renderUntracked(repo.dir, ["new.txt"], 10_000);
		assert.equal(truncated, false);
		assert.match(text, /\+line1/);
		assert.match(text, /\+line2/);
	} finally {
		repo.cleanup();
	}
});

test("/diff notifies about changes in the repo", async () => {
	const repo = makeRepo();
	try {
		const harness = await createHarness({ sessionFile: join(repo.dir, "s.jsonl") });
		harness.ctx.cwd = repo.dir;
		writeFileSync(join(repo.dir, "file.txt"), "changed\n");
		await harness.command("diff")!.handler("", harness.ctx);
		assert.ok(harness.notifications.some((n) => n.message.includes("file.txt")));
	} finally {
		repo.cleanup();
	}
});

test("/diff on a clean repo reports no changes", async () => {
	const repo = makeRepo();
	try {
		const harness = await createHarness({ sessionFile: join(repo.dir, "s.jsonl") });
		harness.ctx.cwd = repo.dir;
		await harness.command("diff")!.handler("", harness.ctx);
		assert.ok(harness.notifications.some((n) => n.message.includes("No changes")));
	} finally {
		repo.cleanup();
	}
});

test("/diff outside a git repo reports the error", async () => {
	const harness = await createHarness();
	harness.ctx.cwd = "/nonexistent";
	await harness.command("diff")!.handler("", harness.ctx);
	assert.ok(harness.notifications.some((n) => n.type === "error"));
});

test("/review sends a review task message with the diff", async () => {
	const repo = makeRepo();
	try {
		const harness = await createHarness({ sessionFile: join(repo.dir, "s.jsonl") });
		harness.ctx.cwd = repo.dir;
		writeFileSync(join(repo.dir, "file.txt"), "changed\n");
		await harness.command("review")!.handler("", harness.ctx);
		const task = harness.sentMessages.find((m) => m.message.customType === "pi-from-codex-review-task");
		assert.ok(task, "expected a review task message");
		assert.match(task.message.content, /working-tree changes/);
		assert.match(task.message.content, /file\.txt/);
		assert.ok(task.options?.triggerTurn === true);
	} finally {
		repo.cleanup();
	}
});

test("/review --cached reviews staged changes", async () => {
	const repo = makeRepo();
	try {
		const harness = await createHarness({ sessionFile: join(repo.dir, "s.jsonl") });
		harness.ctx.cwd = repo.dir;
		writeFileSync(join(repo.dir, "file.txt"), "staged\n");
		execFileSync("git", ["add", "file.txt"], { cwd: repo.dir });
		await harness.command("review")!.handler("--cached", harness.ctx);
		const task = harness.sentMessages.find((m) => m.message.customType === "pi-from-codex-review-task");
		assert.ok(task);
		assert.match(task.message.content, /staged changes/);
	} finally {
		repo.cleanup();
	}
});

test("/review with no changes does not send a task", async () => {
	const repo = makeRepo();
	try {
		const harness = await createHarness({ sessionFile: join(repo.dir, "s.jsonl") });
		harness.ctx.cwd = repo.dir;
		await harness.command("review")!.handler("", harness.ctx);
		assert.equal(harness.sentMessages.filter((m) => m.message.customType === "pi-from-codex-review-task").length, 0);
	} finally {
		repo.cleanup();
	}
});
