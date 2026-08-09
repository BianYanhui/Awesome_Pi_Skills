// `/plan` — plan mode toggle, ported from Codex's `/plan` command
// ("switch to Plan mode"). While plan mode is active, Pi analyzes the task
// and produces a plan without modifying files, then waits for approval.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PLAN_ENTRY_TYPE = "pi-from-codex-plan-mode";
export const PLAN_CONTEXT_TYPE = "pi-from-codex-plan-instruction";
export const PLAN_STATUS_KEY = "plan";

interface PlanState {
	version: 1;
	enabled: boolean;
	updatedAt: string;
}

const PLAN_INSTRUCTION = `You are in PLAN MODE.

- Analyze the request and produce a concrete implementation plan before making any changes.
- Do NOT modify, create, or delete files yet.
- Present the plan (steps, files to touch, risks) and explicitly wait for the user to approve it.
- Only after the user confirms may you execute the plan.`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function decodePlanState(entry: unknown): PlanState | null {
	if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== PLAN_ENTRY_TYPE) return null;
	const data = entry.data;
	if (!isRecord(data) || data.version !== 1 || typeof data.enabled !== "boolean") return null;
	return { version: 1, enabled: data.enabled, updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "" };
}

function latestPlanState(entries: readonly unknown[]): PlanState | null {
	for (const entry of [...entries].reverse()) {
		const state = decodePlanState(entry);
		if (state) return state;
	}
	return null;
}

export default function planExtension(pi: ExtensionAPI) {
	let enabled = false;

	function persist() {
		pi.appendEntry(PLAN_ENTRY_TYPE, { version: 1, enabled, updatedAt: new Date().toISOString() });
	}

	function renderStatus(ctx?: ExtensionContext) {
		if (ctx) ctx.ui.setStatus(PLAN_STATUS_KEY, enabled ? "plan mode" : undefined);
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode: analyze first, do not modify files until approved",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			let next: boolean | null = null;
			if (arg === "on" || arg === "1" || arg === "true" || arg === "yes") next = true;
			else if (arg === "off" || arg === "0" || arg === "false" || arg === "no") next = false;
			else if (arg === "" || arg === "toggle") next = !enabled;
			else {
				ctx.ui.notify("Usage: /plan [on|off]", "error");
				return;
			}
			enabled = next;
			persist();
			renderStatus(ctx);
			ctx.ui.notify(enabled ? "Plan mode ON: Pi will plan first and wait for approval before touching files." : "Plan mode OFF.", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		enabled = latestPlanState(ctx.sessionManager.getBranch())?.enabled ?? false;
		renderStatus(ctx);
	});

	pi.on("before_agent_start", async () => {
		if (enabled) {
			pi.sendMessage({
				customType: PLAN_CONTEXT_TYPE,
				content: PLAN_INSTRUCTION,
				display: false,
			});
		}
	});

	pi.on("session_shutdown", async () => {
		// ctx is invalidated during session replacement; plan state is persisted
		// in session entries and restored on session_start.
	});
}
