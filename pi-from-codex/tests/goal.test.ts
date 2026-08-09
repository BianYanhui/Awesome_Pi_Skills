// Integration tests for the /goal command and goal_* tools.

import assert from "node:assert/strict";
import test from "node:test";
import { GOAL_ENTRY_TYPE } from "../src/goal/types.js";
import { createHarness, lastEntryOfType, parseToolResponse, type HarnessReturn } from "./helpers.js";

const OBJECTIVE = "ship the redesigned goal mode";

function persistedGoal(harness: HarnessReturn): { goal: Record<string, unknown> | null } {
	const entry = lastEntryOfType<{ version: number; goal: Record<string, unknown> | null }>(harness.entries, GOAL_ENTRY_TYPE);
	return { goal: entry?.data.goal ?? null };
}

function activeGoal(harness: HarnessReturn): Record<string, unknown> {
	const goal = persistedGoal(harness).goal;
	assert.ok(goal, "expected a persisted goal");
	return goal;
}

// ─── /goal command ──────────────────────────────────────────────────────

test("/goal <objective> activates a goal immediately (no setup interview)", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	const goal = activeGoal(harness);
	assert.equal(goal.status, "active");
	assert.equal(goal.objective, OBJECTIVE);
	assert.ok(harness.notifications.some((n) => n.message.includes("Goal set")));
});

test("/goal with --token-budget sets the budget", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(`${OBJECTIVE} --token-budget 50000`, harness.ctx);
	assert.equal(activeGoal(harness).tokenBudget, 50000);
});

test("/goal status shows the goal panel", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.command("goal")!.handler("status", harness.ctx);
	assert.ok(harness.notifications.some((n) => n.message.includes("Status: active") && n.message.includes(OBJECTIVE)));
});

test("/goal status with no goal shows usage", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler("status", harness.ctx);
	assert.ok(harness.notifications.some((n) => n.message.includes("No active goal")));
});

test("/goal edit replaces the objective", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.command("goal")!.handler("edit ship a simpler goal", harness.ctx);
	assert.equal(activeGoal(harness).objective, "ship a simpler goal");
});

test("/goal budget sets and clears the budget", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.command("goal")!.handler("budget 2000", harness.ctx);
	assert.equal(activeGoal(harness).tokenBudget, 2000);
	await harness.command("goal")!.handler("budget 0", harness.ctx);
	assert.equal(activeGoal(harness).tokenBudget, null);
});

test("/goal pause and resume transition status", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.command("goal")!.handler("pause", harness.ctx);
	assert.equal(activeGoal(harness).status, "paused");
	await harness.command("goal")!.handler("resume", harness.ctx);
	assert.equal(activeGoal(harness).status, "active");
});

test("/goal clear removes the goal", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.command("goal")!.handler("clear", harness.ctx);
	assert.equal(persistedGoal(harness).goal, null);
});

test("/goal refuses a second active goal", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.command("goal")!.handler("another objective", harness.ctx);
	assert.equal(activeGoal(harness).objective, OBJECTIVE);
	assert.ok(harness.notifications.some((n) => n.message.includes("already exists")));
});

test("/goal accepts a new goal after completion", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.tool("goal_complete")!.execute("c1", { status: "complete" }, undefined, undefined, harness.ctx);
	await harness.command("goal")!.handler("next goal", harness.ctx);
	assert.equal(activeGoal(harness).objective, "next goal");
});

// ─── goal tools ─────────────────────────────────────────────────────────

test("goal_get returns null without a goal", async () => {
	const harness = await createHarness();
	const result = await harness.tool("goal_get")!.execute("g1", {}, undefined, undefined, harness.ctx);
	const parsed = parseToolResponse(result);
	assert.equal(parsed.goal, null);
});

test("goal_get returns the active goal state", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	const result = await harness.tool("goal_get")!.execute("g1", {}, undefined, undefined, harness.ctx);
	const parsed = parseToolResponse(result) as { goal: { objective: string; status: string } };
	assert.equal(parsed.goal.objective, OBJECTIVE);
	assert.equal(parsed.goal.status, "active");
});

test("goal_status_line updates the progress line", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.tool("goal_status_line")!.execute("s1", { text: "porting the state machine" }, undefined, undefined, harness.ctx);
	assert.equal(activeGoal(harness).statusLine, "porting the state machine");
});

test("goal_status_line rejects empty text", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	const result = await harness.tool("goal_status_line")!.execute("s1", { text: "   " }, undefined, undefined, harness.ctx);
	assert.equal(result.isError, true);
});

test("goal_status_line rejects without an active goal", async () => {
	const harness = await createHarness();
	const result = await harness.tool("goal_status_line")!.execute("s1", { text: "progress" }, undefined, undefined, harness.ctx);
	assert.equal(result.isError, true);
});

test("goal_complete marks the goal complete", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.tool("goal_complete")!.execute("c1", { status: "complete" }, undefined, undefined, harness.ctx);
	assert.equal(activeGoal(harness).status, "complete");
	assert.ok(harness.notifications.some((n) => n.message.includes("Goal complete")));
});

test("goal_complete rejects without a goal", async () => {
	const harness = await createHarness();
	const result = await harness.tool("goal_complete")!.execute("c1", { status: "complete" }, undefined, undefined, harness.ctx);
	assert.equal(result.isError, true);
});

// ─── budget limiting ────────────────────────────────────────────────────

test("turn_end flips the goal to budget_limited at the budget", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(`${OBJECTIVE} --token-budget 1000`, harness.ctx);
	await harness.emit("turn_end", {
		message: { role: "assistant", usage: { totalTokens: 1500 } },
	});
	assert.equal(activeGoal(harness).status, "budget_limited");
	// A follow-up message tells the agent to stop and ask the user.
	assert.ok(harness.sentMessages.some((m) => m.message.customType === "pi-from-codex-goal-context" && m.message.content.includes("token budget")));
});

test("turn_end accumulates tokens under the budget", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(`${OBJECTIVE} --token-budget 10000`, harness.ctx);
	await harness.emit("turn_end", { message: { role: "assistant", usage: { totalTokens: 3000 } } });
	assert.equal(activeGoal(harness).tokensUsed, 3000);
	assert.equal(activeGoal(harness).status, "active");
});

test("before_agent_start injects the active goal reminder", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.emit("before_agent_start", { prompt: "continue" });
	assert.ok(harness.sentMessages.some((m) => m.message.customType === "pi-from-codex-goal-context" && m.message.content.includes(OBJECTIVE)));
});

test("before_agent_start injects nothing without a goal", async () => {
	const harness = await createHarness();
	await harness.emit("before_agent_start", { prompt: "hi" });
	assert.equal(harness.sentMessages.length, 0);
});

test("session_start restores the goal from persisted entries", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	const saved = persistedGoal(harness).goal;
	const restored = await createHarness({ entries: [{ type: "custom", customType: GOAL_ENTRY_TYPE, data: { version: 1, goal: saved } }] });
	await restored.emit("session_start", { reason: "startup" });
	const result = await restored.tool("goal_get")!.execute("g1", {}, undefined, undefined, restored.ctx);
	assert.equal((parseToolResponse(result) as { goal: { objective: string } }).goal.objective, OBJECTIVE);
});

// ─── autonomous continuation ─────────────────────────────────────────────

test("/goal immediately queues the first continuation turn", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	const continuation = harness.sentMessages.find((m) => m.message.customType === "pi-from-codex-goal-continuation");
	assert.ok(continuation, "expected a continuation message after setting the goal");
	assert.match(continuation.message.content, /Continue working toward/);
	assert.equal(continuation.options?.triggerTurn, true);
});

test("agent_settled queues another continuation after a working turn", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	harness.sentMessages.length = 0;
	// Simulate the continuation turn running with tool calls.
	await harness.emit("turn_start", {});
	await harness.emit("tool_execution_end", {});
	await harness.emit("turn_end", { message: { role: "assistant", usage: { totalTokens: 100 } } });
	await harness.emit("agent_settled", {});
	assert.ok(
		harness.sentMessages.some((m) => m.message.customType === "pi-from-codex-goal-continuation"),
		"expected a follow-up continuation after a working turn",
	);
});

test("agent_settled does not continue when the agent asked a question", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	harness.sentMessages.length = 0;
	await harness.emit("turn_start", {});
	await harness.emit("turn_end", { message: { role: "assistant", content: "Which approach should I take?" } });
	await harness.emit("agent_settled", {});
	assert.equal(harness.sentMessages.filter((m) => m.message.customType === "pi-from-codex-goal-continuation").length, 0);
	assert.equal(persistedGoal(harness).goal?.blockedReason, "waiting_on_user");
});

test("agent_settled pauses continuation when an auto turn does no work", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	harness.sentMessages.length = 0;
	// Continuation turn runs but calls no tools.
	await harness.emit("turn_start", {});
	await harness.emit("turn_end", { message: { role: "assistant", content: "Nothing left to do here." } });
	await harness.emit("agent_settled", {});
	assert.equal(harness.sentMessages.filter((m) => m.message.customType === "pi-from-codex-goal-continuation").length, 0);
	assert.equal(persistedGoal(harness).goal?.status, "active");
	assert.equal(persistedGoal(harness).goal?.blockedReason, "no_work");
	assert.ok(harness.notifications.some((n) => n.message.includes("no work was found")));
});

test("agent_settled does not continue when the user has pending messages", async () => {
	const harness = await createHarness({ pendingMessages: true });
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	harness.sentMessages.length = 0;
	await harness.emit("agent_settled", {});
	assert.equal(harness.sentMessages.filter((m) => m.message.customType === "pi-from-codex-goal-continuation").length, 0);
	assert.equal(persistedGoal(harness).goal?.blockedReason, "waiting_on_user");
});

test("goal_complete stops further continuation", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	harness.sentMessages.length = 0;
	await harness.tool("goal_complete")!.execute("c1", { status: "complete" }, undefined, undefined, harness.ctx);
	await harness.emit("agent_settled", {});
	assert.equal(harness.sentMessages.filter((m) => m.message.customType === "pi-from-codex-goal-continuation").length, 0);
});

test("session_shutdown does not pause the goal (side-conversation friendly)", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	await harness.emit("session_shutdown", { reason: "new", targetSessionFile: "/tmp/side.jsonl" });
	assert.equal(persistedGoal(harness).goal?.status, "active", "goal must stay active across session switches");
});

test("returning to the session resumes autonomous continuation", async () => {
	const harness = await createHarness();
	await harness.command("goal")!.handler(OBJECTIVE, harness.ctx);
	harness.sentMessages.length = 0;
	// Simulate switching away (e.g. /btw) and coming back.
	await harness.emit("session_shutdown", { reason: "new", targetSessionFile: "/tmp/side.jsonl" });
	await harness.emit("session_start", { reason: "resume", previousSessionFile: "/tmp/side.jsonl" });
	assert.ok(
		harness.sentMessages.some((m) => m.message.customType === "pi-from-codex-goal-continuation"),
		"expected continuation to resume automatically after returning",
	);
});
