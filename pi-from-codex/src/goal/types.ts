// Goal types. The status model mirrors Codex's `ThreadGoalStatus`
// (codex-rs/app-server-protocol/src/protocol/v2/thread.rs):
// active | paused | blocked | usage_limited | budget_limited | complete.
// We intentionally keep it minimal: no setup-interview phase (unlike pi-goal).

export const GOAL_ENTRY_TYPE = "pi-from-codex-goal-state";

export type GoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";

export type BlockedReason = "waiting_on_user" | "no_work" | "user_input_needed" | string | null;

export interface GoalState {
	version: 1;
	id: string;
	generation: number;
	objective: string;
	status: GoalStatus;
	statusLine: string | null;
	tokenBudget: number | null;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: string;
	updatedAt: string;
	blockedReason: BlockedReason;
	/** True while an automatic continuation turn is suppressed (e.g. no work found). */
	continuationSuppressed: boolean;
}

export type GoalToolDetails = {
	goal: GoalState | null;
	remainingTokens: number | null;
	completionBudgetReport: string | null;
};

export const STATUS_LABELS: Record<GoalStatus, string> = {
	active: "active",
	paused: "paused",
	blocked: "stalled",
	usage_limited: "usage limited",
	budget_limited: "limited by budget",
	complete: "complete",
};

/** Canonical help text, loosely modeled on Codex's GOAL_USAGE. */
export const GOAL_USAGE = "Usage: /goal [<objective>|status|edit <objective>|budget <n>|pause|resume|clear|help] [--token-budget <n>]";
