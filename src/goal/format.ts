// Goal formatting helpers. Ported from Codex `goal_display.rs`:
// - format_goal_elapsed_seconds
// - goal_status_label
// - goal_usage_summary

import type { GoalState, GoalStatus } from "./types.js";

/** Compact human duration, e.g. 0s / 59s / 1m / 30m / 1h 30m / 23h 59m / 1d 2h 3m. */
export function formatGoalElapsedSeconds(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	if (safe < 60) return `${safe}s`;
	const minutes = Math.floor(safe / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours >= 24) {
		const days = Math.floor(hours / 24);
		const remainingHours = hours % 24;
		return `${days}d ${remainingHours}h ${remainingMinutes}m`;
	}
	if (remainingMinutes === 0) return `${hours}h`;
	return `${hours}h ${remainingMinutes}m`;
}

export function goalStatusLabel(status: GoalStatus): string {
	switch (status) {
		case "active":
			return "active";
		case "paused":
			return "paused";
		case "blocked":
			return "stalled";
		case "usage_limited":
			return "usage limited";
		case "budget_limited":
			return "limited by budget";
		case "complete":
			return "complete";
	}
}

/** Compact token count, e.g. 12.3k / 1.2M. */
export function formatTokensCompact(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) {
		const value = tokens / 1000;
		const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
		return `${rounded}k`;
	}
	const value = tokens / 1_000_000;
	const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded}M`;
}

/** One-line goal summary, mirrors Codex `goal_usage_summary`. */
export function goalUsageSummary(goal: GoalState): string {
	const parts = [`Objective: ${goal.objective}`];
	if (goal.timeUsedSeconds > 0) {
		parts.push(`Time: ${formatGoalElapsedSeconds(goal.timeUsedSeconds)}.`);
	}
	if (goal.tokenBudget !== null) {
		parts.push(`Tokens: ${formatTokensCompact(goal.tokensUsed)}/${formatTokensCompact(goal.tokenBudget)}.`);
	} else if (goal.tokensUsed > 0) {
		parts.push(`Tokens: ${formatTokensCompact(goal.tokensUsed)}.`);
	}
	return parts.join(" ");
}

/** Multi-line status panel shown by `/goal status`. */
export function goalStatusPanel(goal: GoalState): string {
	const lines = [
		`Status: ${goalStatusLabel(goal.status)}`,
		`Objective: ${goal.objective}`,
	];
	if (goal.statusLine) lines.push(`Progress: ${goal.statusLine}`);
	lines.push(`Time: ${formatGoalElapsedSeconds(goal.timeUsedSeconds)}`);
	if (goal.tokenBudget !== null) {
		lines.push(`Tokens: ${formatTokensCompact(goal.tokensUsed)} / ${formatTokensCompact(goal.tokenBudget)} (${goal.tokenBudget - goal.tokensUsed} remaining)`);
	} else if (goal.tokensUsed > 0) {
		lines.push(`Tokens: ${formatTokensCompact(goal.tokensUsed)}`);
	}
	if (goal.status === "blocked" && goal.blockedReason) {
		lines.push(`Blocked: ${goal.blockedReason}`);
	}
	return lines.join("\n");
}

export function remainingTokens(goal: GoalState): number | null {
	if (goal.tokenBudget === null) return null;
	return Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

export function completionBudgetReport(goal: GoalState): string | null {
	if (goal.status !== "complete") return null;
	const budgetLine =
		goal.tokenBudget !== null
			? `Tokens: ${formatTokensCompact(goal.tokensUsed)}/${formatTokensCompact(goal.tokenBudget)}.`
			: `Tokens: ${formatTokensCompact(goal.tokensUsed)}.`;
	return `Goal complete. Time: ${formatGoalElapsedSeconds(goal.timeUsedSeconds)}. ${budgetLine}`;
}
