// Unit tests for goal formatting helpers (ported from Codex goal_display.rs tests).

import assert from "node:assert/strict";
import test from "node:test";
import { completionBudgetReport, formatGoalElapsedSeconds, formatTokensCompact, goalStatusPanel, goalStatusLabel, goalUsageSummary } from "../src/goal/format.js";
import { newGoal } from "../src/goal/state.js";
import type { GoalState } from "../src/goal/types.js";

test("formatGoalElapsedSeconds produces compact durations", () => {
	assert.equal(formatGoalElapsedSeconds(0), "0s");
	assert.equal(formatGoalElapsedSeconds(59), "59s");
	assert.equal(formatGoalElapsedSeconds(60), "1m");
	assert.equal(formatGoalElapsedSeconds(30 * 60), "30m");
	assert.equal(formatGoalElapsedSeconds(90 * 60), "1h 30m");
	assert.equal(formatGoalElapsedSeconds(2 * 60 * 60), "2h");
	assert.equal(formatGoalElapsedSeconds(24 * 60 * 60 - 1), "23h 59m");
	assert.equal(formatGoalElapsedSeconds(24 * 60 * 60), "1d 0h 0m");
	assert.equal(formatGoalElapsedSeconds(26 * 60 * 60 + 3 * 60), "1d 2h 3m");
	assert.equal(formatGoalElapsedSeconds(-10), "0s");
});

test("formatTokensCompact formats k and M", () => {
	assert.equal(formatTokensCompact(0), "0");
	assert.equal(formatTokensCompact(999), "999");
	assert.equal(formatTokensCompact(1000), "1k");
	assert.equal(formatTokensCompact(12345), "12.3k");
	assert.equal(formatTokensCompact(123456), "123k");
	assert.equal(formatTokensCompact(1_000_000), "1M");
	assert.equal(formatTokensCompact(12_345_678), "12.3M");
});

test("goalStatusLabel matches Codex labels", () => {
	assert.equal(goalStatusLabel("active"), "active");
	assert.equal(goalStatusLabel("paused"), "paused");
	assert.equal(goalStatusLabel("blocked"), "stalled");
	assert.equal(goalStatusLabel("usage_limited"), "usage limited");
	assert.equal(goalStatusLabel("budget_limited"), "limited by budget");
	assert.equal(goalStatusLabel("complete"), "complete");
});

function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
	return {
		...newGoal("ship the redesign", 100_000, 1),
		...overrides,
	};
}

test("goalUsageSummary mirrors Codex goal_usage_summary", () => {
	assert.equal(
		goalUsageSummary(makeGoal({ tokenBudget: 100_000, tokensUsed: 12_345, timeUsedSeconds: 5400 })),
		"Objective: ship the redesign Time: 1h 30m. Tokens: 12.3k/100k.",
	);
	// No budget, no time => objective only.
	assert.equal(goalUsageSummary(makeGoal({ tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0 })), "Objective: ship the redesign");
	// No budget but tokens used.
	assert.equal(goalUsageSummary(makeGoal({ tokenBudget: null, tokensUsed: 5000, timeUsedSeconds: 0 })), "Objective: ship the redesign Tokens: 5k.");
});

test("goalStatusPanel includes progress, time, and tokens", () => {
	const panel = goalStatusPanel(
		makeGoal({ statusLine: "writing tests", tokenBudget: 100_000, tokensUsed: 1000, timeUsedSeconds: 120 }),
	);
	assert.match(panel, /Status: active/);
	assert.match(panel, /Objective: ship the redesign/);
	assert.match(panel, /Progress: writing tests/);
	assert.match(panel, /Time: 2m/);
	assert.match(panel, /Tokens: 1k \/ 100k \(99000 remaining\)/);
});

test("completionBudgetReport only when complete", () => {
	assert.equal(completionBudgetReport(makeGoal({ status: "active" })), null);
	const report = completionBudgetReport(makeGoal({ status: "complete", tokenBudget: 1000, tokensUsed: 900, timeUsedSeconds: 60 }));
	assert.ok(report);
	assert.match(report ?? "", /Goal complete\. Time: 1m\. Tokens: 900\/1k\./);
});
