// Goal state machine and persistence helpers.

import { randomUUID } from "node:crypto";
import type { BlockedReason, GoalState, GoalStatus } from "./types.js";

export function nowIso(): string {
	return new Date().toISOString();
}

/** Objective sanitization: trim, collapse whitespace, reject empty/oversized. */
export function sanitizeObjective(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

export function validateObjective(objective: string | null | undefined): string | null {
	if (!objective || objective.length === 0) return "Objective must not be empty.";
	if (objective.length > 4096) return "Objective must be at most 4096 characters.";
	if (objective.length < 4) return "Objective is too short; describe the goal in a few words.";
	return null;
}

export function validateTokenBudget(budget: number | null | undefined): string | null {
	if (budget === null || budget === undefined) return null;
	if (!Number.isInteger(budget)) return "Token budget must be an integer.";
	if (budget < 0) return "Token budget must be non-negative.";
	if (budget > 1_000_000_000) return "Token budget is unreasonably large.";
	return null;
}

export function validateProgressText(text: string): string | null {
	const trimmed = text.trim();
	if (!trimmed) return "Progress text must not be empty.";
	if (trimmed.length > 200) return "Progress text must be at most 200 characters.";
	return null;
}

export function newGoal(objective: string, tokenBudget: number | null, generation: number): GoalState {
	const now = nowIso();
	return {
		version: 1,
		id: randomUUID(),
		generation,
		objective,
		status: "active",
		statusLine: null,
		tokenBudget,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: now,
		updatedAt: now,
		blockedReason: null,
		continuationSuppressed: false,
	};
}

/** Transition to a new status, updating timestamps. */
export function setStatus(goal: GoalState, status: GoalStatus, blockedReason: BlockedReason = null): GoalState {
	goal.status = status;
	goal.blockedReason = blockedReason;
	if (status === "active") {
		goal.continuationSuppressed = false;
	}
	goal.updatedAt = nowIso();
	return goal;
}

/** True once the token budget has been exhausted. */
export function applyBudgetLimit(goal: GoalState): boolean {
	if (goal.tokenBudget === null || goal.status === "complete") return false;
	if (goal.tokensUsed >= goal.tokenBudget && goal.status !== "budget_limited") {
		setStatus(goal, "budget_limited");
		return true;
	}
	return false;
}

export function addTurnUsage(goal: GoalState, inputTokens: number, outputTokens: number): void {
	goal.tokensUsed += Math.max(0, inputTokens) + Math.max(0, outputTokens);
	goal.updatedAt = nowIso();
}

/** Accumulate wall-clock time while active. Returns elapsed seconds just added. */
export function accountElapsed(goal: GoalState | null, activeTurnStartedAt: number | null, now: number = Date.now()): number {
	if (!goal || goal.status !== "active" || activeTurnStartedAt === null) return 0;
	const elapsedSeconds = Math.max(0, Math.floor((now - activeTurnStartedAt) / 1000));
	if (elapsedSeconds <= 0) return 0;
	goal.timeUsedSeconds += elapsedSeconds;
	goal.updatedAt = nowIso();
	return elapsedSeconds;
}

export function completeGoal(goal: GoalState): GoalState {
	goal.tokensUsed = Math.max(goal.tokensUsed, 0);
	setStatus(goal, "complete");
	goal.blockedReason = null;
	goal.continuationSuppressed = false;
	return goal;
}
