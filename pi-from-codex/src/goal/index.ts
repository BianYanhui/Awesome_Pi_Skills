// `/goal` command and `goal_*` tools.
//
// Modeled on Codex's goal command (codex-rs/tui/src/goal_display.rs +
// app-server ThreadGoal), simplified: `/goal <objective>` activates a goal
// immediately, no setup interview. The agent interacts through goal_get,
// goal_status_line, and goal_complete.

import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	completionBudgetReport,
	formatGoalElapsedSeconds,
	goalStatusLabel,
	goalStatusPanel,
	goalUsageSummary,
	remainingTokens,
} from "./format.js";
import {
	accountElapsed,
	applyBudgetLimit,
	completeGoal,
	newGoal,
	sanitizeObjective,
	setStatus,
	validateObjective,
	validateProgressText,
	validateTokenBudget,
} from "./state.js";
import { GOAL_ENTRY_TYPE, GOAL_USAGE, type GoalState, type GoalToolDetails } from "./types.js";

export const GOAL_CONTEXT_TYPE = "pi-from-codex-goal-context";
export const GOAL_CONTINUATION_TYPE = "pi-from-codex-goal-continuation";

const STATUS_KEY = "goal";
const STATUS_HEARTBEAT_MS = 5000;

const GoalStatusLineParams = Type.Object({
	text: Type.String(),
});
const GoalCompleteParams = Type.Object({
	status: Type.Union([Type.Literal("complete")]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function entryContent(entry: unknown): string {
	if (!isRecord(entry)) return "";
	if (isRecord(entry.message) && typeof entry.message.content === "string") return entry.message.content;
	if (isRecord(entry.message) && Array.isArray(entry.message.content)) {
		return entry.message.content
			.map((part: unknown) => {
				if (typeof part === "string") return part;
				if (!isRecord(part)) return "";
				const inner = part.content ?? part.text ?? part.input_text;
				if (typeof inner === "string") return inner;
				if (Array.isArray(inner)) {
					return inner
						.map((piece: unknown) => (isRecord(piece) && typeof piece.text === "string" ? piece.text : ""))
						.join("\n");
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function assistantUsageTokens(message: unknown): number {
	if (!isRecord(message) || message.role !== "assistant") return 0;
	const usage = message.usage as Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }> | undefined;
	if (!usage) return 0;
	if (Number.isInteger(usage.totalTokens) && (usage.totalTokens ?? 0) >= 0) return usage.totalTokens ?? 0;
	const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
	if (parts.some((value) => !Number.isInteger(value) || (value ?? 0) < 0)) return 0;
	return (parts as number[]).reduce((sum, value) => sum + value, 0);
}

function decodeGoalState(entry: unknown): GoalState | null {
	if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) return null;
	const data = entry.data;
	if (!isRecord(data) || data.version !== 1) return null;
	const goal = data.goal;
	if (!isRecord(goal) || typeof goal.id !== "string" || typeof goal.objective !== "string") return null;
	return goal as unknown as GoalState;
}

function latestGoal(entries: readonly unknown[]): GoalState | null {
	for (const entry of [...entries].reverse()) {
		const goal = decodeGoalState(entry);
		if (goal) return goal;
	}
	return null;
}

function detailsText(goal: GoalState | null): string {
	return JSON.stringify(
		{
			goal,
			remainingTokens: goal ? remainingTokens(goal) : null,
			completionBudgetReport: goal ? completionBudgetReport(goal) : null,
		} satisfies GoalToolDetails,
		null,
		2,
	);
}

export default function goalExtension(pi: ExtensionAPI) {
	let goal: GoalState | null = null;
	let activeTurnStartedAt: number | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let frame = 0;
	let currentTurnToolCalls = 0;
	let lastTurnToolCalls = 0;
	let continuationTurnPending = false;
	let continuationTurnActive = false;
	let lastAssistantAskedQuestion = false;

	function persist() {
		pi.appendEntry(GOAL_ENTRY_TYPE, { version: 1, goal });
	}

	function setGoal(next: GoalState | null, ctx?: ExtensionContext) {
		goal = next;
		if (goal) goal.updatedAt = new Date().toISOString();
		persist();
		if (ctx) renderStatus(ctx);
	}

	function renderStatus(ctx: ExtensionContext) {
		if (goal) {
			ctx.ui.setStatus(STATUS_KEY, goalStatusLineText(goal));
			syncHeartbeat(ctx);
		} else {
			stopHeartbeat();
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function goalStatusLineText(current: GoalState): string {
		const status = goalStatusLabel(current.status);
		if (current.statusLine) return `${status} · ${current.statusLine}`;
		const summary = goalUsageSummary(current);
		return `${status} · ${summary}`;
	}

	function syncHeartbeat(ctx: ExtensionContext) {
		if (!goal || goal.status !== "active" || goal.blockedReason || goal.continuationSuppressed) {
			stopHeartbeat();
			return;
		}
		if (heartbeat) return;
		heartbeat = setInterval(() => {
			if (!goal || goal.status !== "active" || goal.blockedReason || goal.continuationSuppressed) {
				stopHeartbeat();
				return;
			}
			ctx.ui.setStatus(STATUS_KEY, goalStatusLineText(goal));
		}, STATUS_HEARTBEAT_MS);
		heartbeat.unref?.();
	}

	function stopHeartbeat() {
		if (!heartbeat) return;
		clearInterval(heartbeat);
		heartbeat = null;
	}

	function assistantIndicatesWaiting(message: TurnEndEvent["message"]): boolean {
		if (message.role !== "assistant") return false;
		const content = entryContent({ message }).trim();
		return /[?？]\s*$|\b(please confirm|approval needed|needs approval|reply with|choose one|which option|what should|confirm before|approve before|should I|may I)\b/i.test(content);
	}

	function continuationPrompt(current: GoalState): string {
		return `Continue working toward the active session goal: ${current.objective}\nCurrent status: ${goalStatusLabel(current.status)}. Keep making concrete progress. Update progress with goal_status_line as you go, and call goal_complete only when the objective is actually achieved and no required work remains.`;
	}

	function queueContinuation(ctx: ExtensionContext, reason: "command" | "resume" | "settled") {
		if (!goal || goal.status !== "active") return;
		if (goal.blockedReason || goal.continuationSuppressed) return;
		if (continuationTurnPending) return;
		if (ctx.hasPendingMessages()) {
			goal.blockedReason = "waiting_on_user";
			goal.statusLine = "answer needed";
			setGoal(goal, ctx);
			return;
		}
		// Only queue when the agent is fully idle. Do NOT exempt any reason:
		// queueing while a retry/compaction/follow-up is still scheduled stacks
		// turns, balloons the context, and hammers the provider.
		if (!ctx.isIdle()) return;
		continuationTurnPending = true;
		pi.sendMessage(
			{
				customType: GOAL_CONTINUATION_TYPE,
				content: continuationPrompt(goal),
				display: false,
				details: { goalId: goal.id, generation: goal.generation, reason },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	function parseGoalArgs(args: string): { objective: string | null; tokenBudget: number | null; error: string | null } {
		const trimmed = args.trim();
		const budgetMatch = trimmed.match(/\s+--token-budget\s+(\d+)\s*$/);
		const tokenBudget = budgetMatch ? Number.parseInt(budgetMatch[1] ?? "", 10) : null;
		const intent = sanitizeObjective(unquote(budgetMatch ? trimmed.slice(0, budgetMatch.index).trim() : trimmed));
		return {
			objective: intent || null,
			tokenBudget,
			error: tokenBudget !== null ? validateTokenBudget(tokenBudget) : null,
		};
	}

	function unquote(value: string): string {
		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
		return value;
	}

	pi.registerCommand("goal", {
		description: "Set, inspect, pause, resume, edit, or clear a long-running session goal",
		getArgumentCompletions: (prefix: string) => {
			const words = ["status", "edit", "budget", "pause", "resume", "clear", "help"];
			const filtered = words.filter((word) => word.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const command = trimmed.toLowerCase();

			if (!trimmed || command === "status") {
				if (goal) {
					ctx.ui.notify(goalStatusPanel(goal), "info");
				} else {
					ctx.ui.notify("No active goal. Usage: /goal <objective> [--token-budget <n>]", "info");
				}
				renderStatus(ctx);
				return;
			}

			if (command === "help") {
				ctx.ui.notify(GOAL_USAGE, "info");
				return;
			}

			if (command === "clear") {
				goal = null;
				activeTurnStartedAt = null;
				setGoal(null, ctx);
				ctx.ui.notify("Goal cleared.", "info");
				return;
			}

			if (command === "pause") {
				if (!goal) {
					ctx.ui.notify("No goal to pause.", "error");
					return;
				}
				accountElapsed(goal, activeTurnStartedAt);
				activeTurnStartedAt = null;
				setStatus(goal, "paused");
				setGoal(goal, ctx);
				ctx.ui.notify(`Goal paused. ${goalUsageSummary(goal)}`, "info");
				return;
			}

			if (command === "resume") {
				if (!goal) {
					ctx.ui.notify("No goal to resume.", "error");
					return;
				}
				if (goal.status === "complete") {
					ctx.ui.notify("Goal is complete. Use /goal <objective> to start a new one.", "info");
					return;
				}
				if (goal.status === "budget_limited") {
					ctx.ui.notify("Goal is limited by token budget. Raise it with /goal budget <n> first.", "error");
					return;
				}
				setStatus(goal, "active");
				setGoal(goal, ctx);
				ctx.ui.notify(`Goal active. ${goalUsageSummary(goal)}`, "info");
				queueContinuation(ctx, "command");
				return;
			}

			if (command.startsWith("edit ")) {
				if (!goal) {
					ctx.ui.notify("No goal to edit. Start one with /goal <objective>", "error");
					return;
				}
				const nextObjective = sanitizeObjective(args.slice("edit".length));
				const validationError = validateObjective(nextObjective);
				if (validationError) {
					ctx.ui.notify(validationError, "error");
					return;
				}
				goal.objective = nextObjective;
				goal.statusLine = null;
				setGoal(goal, ctx);
				ctx.ui.notify(`Goal updated. ${goalUsageSummary(goal)}`, "info");
				return;
			}

			if (command.startsWith("budget ")) {
				if (!goal) {
					ctx.ui.notify("No goal. Start one with /goal <objective> first.", "error");
					return;
				}
				const raw = args.slice("budget".length).trim();
				const parsed = raw === "" ? null : Number.parseInt(raw, 10);
				if (raw !== "" && (!Number.isInteger(parsed) || (parsed ?? 0) < 0)) {
					ctx.ui.notify("Usage: /goal budget <n> (0 clears the budget)", "error");
					return;
				}
				const budget = parsed === 0 ? null : parsed;
				const validationError = validateTokenBudget(budget);
				if (validationError) {
					ctx.ui.notify(validationError, "error");
					return;
				}
				goal.tokenBudget = budget;
				if (goal.status === "budget_limited" && budget !== null && goal.tokensUsed < budget) {
					setStatus(goal, "active");
				}
				setGoal(goal, ctx);
				ctx.ui.notify(`Budget set. ${goalUsageSummary(goal)}`, "info");
				return;
			}

			// Fall through: treat the full argument string as a new objective.
			if (goal && goal.status !== "complete") {
				ctx.ui.notify(
					`An active goal already exists (${goalStatusLabel(goal.status)}). Use /goal status, /goal edit <objective>, /goal clear, or /goal complete after finishing.`,
					"info",
				);
				renderStatus(ctx);
				return;
			}

			const parsed = parseGoalArgs(trimmed);
			if (parsed.error) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}
			if (!parsed.objective) {
				ctx.ui.notify(GOAL_USAGE, "info");
				return;
			}
			const validationError = validateObjective(parsed.objective);
			if (validationError) {
				ctx.ui.notify(validationError, "error");
				return;
			}
			const next = newGoal(parsed.objective, parsed.tokenBudget, (goal?.generation ?? 0) + 1);
			setGoal(next, ctx);
			ctx.ui.notify(`Goal set: ${next.objective}. ${goalUsageSummary(next)}`, "info");
			queueContinuation(ctx, "command");
		},
	});

	pi.registerTool<typeof GoalStatusLineParams, GoalToolDetails>({
		name: "goal_status_line",
		label: "Update Goal Status Line",
		description: "Update the short current-progress text shown in the status line for the active goal.",
		promptSnippet: "goal_status_line: update the short current-progress text shown in the status line.",
		parameters: GoalStatusLineParams,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!goal || goal.status !== "active") {
				return toolErrorResponse("No active goal. Start one with /goal <objective>.", details());
			}
			const text = params.text.trim();
			const validationError = validateProgressText(text);
			if (validationError) return toolErrorResponse(validationError, details());
			goal.statusLine = text;
			setGoal(goal, ctx);
			return toolOkResponse(details());
		},
	});

	pi.registerTool<typeof GoalCompleteParams, GoalToolDetails>({
		name: "goal_complete",
		label: "Complete Goal",
		description:
			"Complete the existing long-running session goal. Use this tool only when the objective has actually been achieved and no required work remains. Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.",
		promptSnippet: "goal_complete: mark the current long-running session goal complete when it is actually achieved.",
		parameters: GoalCompleteParams,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.status !== "complete") {
				return toolErrorResponse("Goal completion requires status \"complete\".", details());
			}
			if (!goal) {
				return toolErrorResponse("No active goal to complete.", details());
			}
			accountElapsed(goal, activeTurnStartedAt);
			activeTurnStartedAt = null;
			completeGoal(goal);
			setGoal(goal, ctx);
			ctx.ui.notify(`🎉 ${completionBudgetReport(goal) ?? "Goal complete."}`, "info");
			return toolOkResponse(details());
		},
	});

	pi.registerTool({
		name: "goal_get",
		label: "Get Goal",
		description: "Get the current long-running session goal state, including status, budget, elapsed time, and remaining token budget.",
		promptSnippet: "goal_get: inspect the current long-running session goal state.",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: detailsText(goal) }], details: details() };
		},
	});

	pi.on("session_start", async (event, ctx) => {
		goal = latestGoal(ctx.sessionManager.getBranch());
		activeTurnStartedAt = null;
		currentTurnToolCalls = 0;
		lastTurnToolCalls = 0;
		continuationTurnPending = false;
		continuationTurnActive = false;
		lastAssistantAskedQuestion = false;
		renderStatus(ctx);
		if (goal?.status === "active" && (event.reason === "startup" || event.reason === "resume" || event.reason === "reload")) {
			// Restore autonomous continuation after reload/resume.
			queueMicrotask(() => queueContinuation(ctx, "resume"));
		}
	});

	pi.on("turn_start", async (_event, ctx) => {
		currentTurnToolCalls = 0;
		lastAssistantAskedQuestion = false;
		continuationTurnActive = continuationTurnPending;
		continuationTurnPending = false;
		if (goal?.status === "active") {
			if (goal.blockedReason === "waiting_on_user" && !ctx.hasPendingMessages()) {
				goal.blockedReason = null;
				goal.statusLine = "resuming";
			}
			activeTurnStartedAt = Date.now();
			renderStatus(ctx);
		}
	});

	pi.on("tool_execution_end", async () => {
		currentTurnToolCalls++;
		if (goal?.status === "active") {
			goal.continuationSuppressed = false;
			if (goal.blockedReason === "no_work") goal.blockedReason = null;
		}
	});

	pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
		lastTurnToolCalls = currentTurnToolCalls;
		lastAssistantAskedQuestion = assistantIndicatesWaiting(event.message);
		accountElapsed(goal, activeTurnStartedAt);
		activeTurnStartedAt = null;
		if (!goal || goal.status !== "active") return;
		const tokens = assistantUsageTokens(event.message);
		if (tokens > 0) {
			goal.tokensUsed += tokens;
			goal.updatedAt = new Date().toISOString();
			persist();
		}
		if (applyBudgetLimit(goal)) {
			setGoal(goal, ctx);
			ctx.ui.notify(`Goal reached its token budget (${goal.tokenBudget}). Use /goal budget <n> to raise it or /goal clear to stop.`, "error");
			pi.sendMessage(
				{
					customType: GOAL_CONTEXT_TYPE,
					content: `The active goal has reached its token budget (${goal.tokensUsed}/${goal.tokenBudget}). Stop autonomously; report progress and ask the user how to proceed (raise budget, pause, or clear).`,
					display: false,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		// agent_settled fires only when the agent is fully done (no retries,
		// no auto-compaction, no queued follow-ups) — the safe point to queue
		// the next goal continuation.
		if (!goal || goal.status !== "active") return;
		if (ctx.hasPendingMessages()) {
			goal.blockedReason = "waiting_on_user";
			goal.statusLine = "answer needed";
			setGoal(goal, ctx);
			return;
		}
		if (lastAssistantAskedQuestion) {
			goal.blockedReason = "waiting_on_user";
			goal.statusLine = "answer needed";
			setGoal(goal, ctx);
			return;
		}
		if (continuationTurnActive && lastTurnToolCalls === 0) {
			// An automatic continuation ran but did no work: stop nagging.
			goal.continuationSuppressed = true;
			goal.blockedReason = "no_work";
			goal.statusLine = "no progress found";
			setGoal(goal, ctx);
			ctx.ui.notify("Goal continuation paused: no work was found. Use /goal resume to continue, /goal status to inspect, or /goal clear to stop.", "info");
			return;
		}
		queueContinuation(ctx, "settled");
	});

	pi.on("before_agent_start", async (_event, _ctx) => {
		if (goal && goal.status === "active") {
			pi.sendMessage({
				customType: GOAL_CONTEXT_TYPE,
				content: `Active session goal: ${goal.objective} (${goalStatusLabel(goal.status)}). Keep working toward this goal; report progress with goal_status_line and complete with goal_complete when actually achieved.`,
				display: false,
			});
		}
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		accountElapsed(goal, activeTurnStartedAt);
		activeTurnStartedAt = null;
		// Deliberately do NOT pause the goal here: session switches (e.g. /btw
		// side sessions) must leave the goal active so that returning to this
		// session resumes autonomous continuation automatically.
		continuationTurnPending = false;
		continuationTurnActive = false;
		stopHeartbeat();
		// Do not touch ctx here: it is invalidated during session replacement
		// and calling ui methods throws ("stale ctx").
	});

	function details(): GoalToolDetails {
		return {
			goal,
			remainingTokens: goal ? remainingTokens(goal) : null,
			completionBudgetReport: goal ? completionBudgetReport(goal) : null,
		};
	}

	function toolOkResponse(detail: GoalToolDetails) {
		return { content: [{ type: "text" as const, text: JSON.stringify(detail, null, 2) }], details: detail };
	}

	function toolErrorResponse(message: string, detail: GoalToolDetails) {
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							type: "https://pi.local/goal/error",
							title: "Goal error",
							status: "rejected",
							detail: message,
							context: {},
							suggestions: ["Use /goal <objective> to start a goal, or /goal help for usage."],
						},
						null,
						2,
					),
				},
			],
			details: detail,
			isError: true,
		};
	}

	// Silence unused-variable lint for frame (kept for future heartbeat animation).
	void frame;
	// Silence unused import warning if formatGoalElapsedSeconds is not referenced elsewhere.
	void formatGoalElapsedSeconds;
}
