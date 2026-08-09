// Integration tests for /btw (side conversation) and /plan.

import assert from "node:assert/strict";
import test from "node:test";
import { BTW_MARKER_TYPE, decodeBtwMarker, latestBtwMarker } from "../src/btw.js";
import { PLAN_ENTRY_TYPE } from "../src/plan.js";
import { createHarness, lastEntryOfType, type HarnessReturn } from "./helpers.js";

// ─── /btw ───────────────────────────────────────────────────────────────

test("/btw creates an empty side session and records the parent", async () => {
	const harness = await createHarness();
	await harness.command("btw")!.handler("", harness.ctx);
	assert.equal(harness.newSessions.length, 1);
	const options = harness.newSessions[0]?.options as { parentSession?: string } | undefined;
	assert.equal(options?.parentSession, "/tmp/main-session.jsonl");
	const marker = lastEntryOfType<{ version: number; parentSession: string }>(harness.entries, BTW_MARKER_TYPE);
	assert.ok(marker, "expected a btw marker entry");
	assert.equal(marker.data.parentSession, "/tmp/main-session.jsonl");
});

test("/btw does not copy the parent branch into the side session", async () => {
	const harness = await createHarness({
		entries: [{ type: "message", message: { role: "user", content: "let's refactor the parser" } }],
	});
	const before = harness.entries.length;
	await harness.command("btw")!.handler("", harness.ctx);
	// Only the marker should be appended; no copied user/assistant messages.
	const copiedMessages = harness.entries.slice(before).filter((e) => e.type === "message");
	assert.equal(copiedMessages.length, 0);
});

test("/btw <question> sends the question to the side session", async () => {
	const harness = await createHarness();
	await harness.command("btw")!.handler("what does this function do?", harness.ctx);
	const userMessage = harness.sentMessages.find((m) => m.options && "fromBtwFork" in m.options);
	assert.ok(userMessage, "expected the question to be sent to the side session");
	assert.equal(userMessage?.message.content, "what does this function do?");
});

test("/btw-return switches back to the parent session", async () => {
	const harness = await createHarness({ entries: [] });
	await harness.command("btw")!.handler("q?", harness.ctx);
	const harness2 = await createHarness({
		entries: [...harness.entries],
		sessionFile: "/tmp/side-session.jsonl",
	});
	await harness2.emit("session_start", { reason: "fork", previousSessionFile: "/tmp/main-session.jsonl" });
	await harness2.command("btw-return")!.handler("", harness2.ctx);
	assert.equal(harness2.switches.length, 1);
	assert.equal(harness2.switches[0]?.sessionPath, "/tmp/main-session.jsonl");
});

test("/btw-return without a marker is a no-op", async () => {
	const harness = await createHarness();
	await harness.emit("session_start", { reason: "startup" });
	await harness.command("btw-return")!.handler("", harness.ctx);
	assert.equal(harness.switches.length, 0);
	assert.ok(harness.notifications.some((n) => n.message.includes("Not in a side conversation")));
});

test("agent_settled in a side session reminds the user to return", async () => {
	const harness = await createHarness();
	await harness.command("btw")!.handler("q?", harness.ctx);
	const harness2 = await createHarness({ entries: [...harness.entries] });
	await harness2.emit("session_start", { reason: "fork", previousSessionFile: "/tmp/main-session.jsonl" });
	await harness2.emit("agent_settled", {});
	assert.ok(harness2.notifications.some((n) => n.message.includes("/btw-return")));
});

test("agent_settled does not nag when messages are pending", async () => {
	const harness = await createHarness({ entries: [] });
	await harness.command("btw")!.handler("", harness.ctx);
	const harness2 = await createHarness({ entries: [...harness.entries], pendingMessages: true });
	await harness2.emit("session_start", { reason: "fork" });
	await harness2.emit("agent_settled", {});
	assert.equal(harness2.notifications.filter((n) => n.message.includes("/btw-return")).length, 0);
});

test("decodeBtwMarker rejects malformed entries", () => {
	assert.equal(decodeBtwMarker({ type: "custom", customType: BTW_MARKER_TYPE, data: { version: 1 } }), null);
	assert.equal(decodeBtwMarker({ type: "custom", customType: "other", data: { version: 1, parentSession: "x" } }), null);
	const marker = latestBtwMarker([{ type: "custom", customType: BTW_MARKER_TYPE, data: { version: 1, parentSession: "/p.jsonl", parentLeafId: "leaf-9", createdAt: "2026-01-01T00:00:00.000Z" } }]);
	assert.equal(marker?.parentSession, "/p.jsonl");
	assert.equal(marker?.parentLeafId, "leaf-9");
});

// ─── /plan ──────────────────────────────────────────────────────────────

test("/plan toggles on and persists state", async () => {
	const harness = await createHarness();
	await harness.command("plan")!.handler("on", harness.ctx);
	const state = lastEntryOfType<{ version: number; enabled: boolean }>(harness.entries, PLAN_ENTRY_TYPE);
	assert.equal(state?.data.enabled, true);
	assert.ok(harness.notifications.some((n) => n.message.includes("Plan mode ON")));
});

test("/plan off disables plan mode", async () => {
	const harness = await createHarness();
	await harness.command("plan")!.handler("on", harness.ctx);
	await harness.command("plan")!.handler("off", harness.ctx);
	const state = lastEntryOfType<{ version: number; enabled: boolean }>(harness.entries, PLAN_ENTRY_TYPE);
	assert.equal(state?.data.enabled, false);
});

test("/plan bare toggles", async () => {
	const harness = await createHarness();
	await harness.command("plan")!.handler("", harness.ctx);
	assert.equal(lastEntryOfType<{ version: number; enabled: boolean }>(harness.entries, PLAN_ENTRY_TYPE)?.data.enabled, true);
	await harness.command("plan")!.handler("", harness.ctx);
	assert.equal(lastEntryOfType<{ version: number; enabled: boolean }>(harness.entries, PLAN_ENTRY_TYPE)?.data.enabled, false);
});

test("/plan rejects unknown arguments", async () => {
	const harness = await createHarness();
	await harness.command("plan")!.handler("maybe", harness.ctx);
	assert.ok(harness.notifications.some((n) => n.message.includes("Usage: /plan")));
});

test("before_agent_start injects plan instructions when enabled", async () => {
	const harness = await createHarness();
	await harness.command("plan")!.handler("on", harness.ctx);
	await harness.emit("before_agent_start", { prompt: "refactor the parser" });
	assert.ok(harness.sentMessages.some((m) => m.message.customType === "pi-from-codex-plan-instruction" && m.message.content.includes("PLAN MODE")));
});

test("before_agent_start injects nothing when plan mode is off", async () => {
	const harness = await createHarness();
	await harness.emit("before_agent_start", { prompt: "refactor the parser" });
	assert.equal(harness.sentMessages.filter((m) => m.message.customType === "pi-from-codex-plan-instruction").length, 0);
});

test("session_start restores plan mode from persisted entries", async () => {
	const harness = await createHarness();
	await harness.command("plan")!.handler("on", harness.ctx);
	const state = lastEntryOfType<{ version: number; enabled: boolean }>(harness.entries, PLAN_ENTRY_TYPE)!;
	const harness2 = await createHarness({ entries: [{ type: "custom", customType: PLAN_ENTRY_TYPE, data: state.data }] });
	await harness2.emit("session_start", { reason: "startup" });
	await harness2.emit("before_agent_start", { prompt: "x" });
	assert.ok(harness2.sentMessages.some((m) => m.message.customType === "pi-from-codex-plan-instruction"));
});

// Ensure harness type is used for tooling typechecks.
void (null as unknown as HarnessReturn);
