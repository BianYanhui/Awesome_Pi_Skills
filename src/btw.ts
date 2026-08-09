// `/btw` — side conversation support, ported from Codex's `/btw` / `/side`
// command (codex-rs/tui/src/chatwidget/side.rs + app::side).
//
// `/btw [question]` creates an *empty* side conversation in a new session
// (Codex's empty side fork): a clean new page. It records the parent session
// file so `/btw-return` can switch back, and asks the question there. The
// extension reminds the user to return when the side agent settles.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const BTW_MARKER_TYPE = "pi-from-codex-btw-parent";
export const BTW_STATUS_KEY = "btw";

export interface BtwMarker {
	version: 1;
	parentSession: string;
	parentLeafId: string | null;
	createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function decodeBtwMarker(entry: unknown): BtwMarker | null {
	if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== BTW_MARKER_TYPE) return null;
	const data = entry.data;
	if (!isRecord(data) || data.version !== 1 || typeof data.parentSession !== "string") return null;
	return {
		version: 1,
		parentSession: data.parentSession,
		parentLeafId: typeof data.parentLeafId === "string" ? data.parentLeafId : null,
		createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
	};
}

export function latestBtwMarker(entries: readonly unknown[]): BtwMarker | null {
	for (const entry of [...entries].reverse()) {
		const marker = decodeBtwMarker(entry);
		if (marker) return marker;
	}
	return null;
}

export default function btwExtension(pi: ExtensionAPI) {
	let btwParent: BtwMarker | null = null;
	let returned = false;

	function renderStatus(ctx: ExtensionContext) {
		if (btwParent && !returned) {
			ctx.ui.setStatus(BTW_STATUS_KEY, "side conversation · /btw-return to go back");
		} else {
			ctx.ui.setStatus(BTW_STATUS_KEY, undefined);
		}
	}

	pi.registerCommand("btw", {
		description: "Start a side conversation in a fork of the current session (Codex /btw)",
		getArgumentCompletions: (prefix: string) => {
			if (prefix.length === 0) return [{ value: "what do you think about", label: "ask a quick question" }];
			return null;
		},
		handler: async (args, ctx) => {
			const question = args.trim();
			const parentSession = ctx.sessionManager.getSessionFile() ?? "";
			const parentLeafId = ctx.sessionManager.getLeafId();

			// Codex opens an *empty* side conversation: a clean new page whose
			// inherited history is reference-only. We do not copy the parent
			// branch here; the marker lets /btw-return switch back.
			ctx.ui.notify(question ? "Starting side conversation…" : "Starting empty side conversation…", "info");
			const result = await ctx.newSession({
				parentSession,
				setup: async (sm) => {
					sm.appendCustomEntry(BTW_MARKER_TYPE, {
						version: 1,
						parentSession,
						parentLeafId,
						createdAt: new Date().toISOString(),
					});
				},
				withSession: async (replacementCtx) => {
					replacementCtx.ui.notify(
						question
							? "You are now in a side conversation (new page). Ask away; /btw-return goes back to the main session."
							: "You are now in a side conversation (new page). Ask your question; /btw-return goes back to the main session.",
						"info",
					);
					if (question) {
						await replacementCtx.sendUserMessage(question);
					}
				},
			});
			if (result.cancelled) {
				ctx.ui.notify("Side conversation cancelled.", "info");
			}
		},
	});

	pi.registerCommand("btw-return", {
		description: "Return from a side conversation to the parent session (Codex /btw back)",
		handler: async (_args, ctx) => {
			const marker = latestBtwMarker(ctx.sessionManager.getBranch());
			if (!marker) {
				ctx.ui.notify("Not in a side conversation. Start one with /btw [question].", "info");
				return;
			}
			returned = true;
			renderStatus(ctx);
			await ctx.switchSession(marker.parentSession, {
				withSession: async (replacementCtx) => {
					replacementCtx.ui.notify("Back to the main session. 👋", "info");
				},
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		btwParent = latestBtwMarker(ctx.sessionManager.getBranch());
		returned = false;
		renderStatus(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!btwParent || returned) return;
		if (ctx.hasPendingMessages() || !ctx.isIdle()) return;
		ctx.ui.notify("Side conversation complete. Run /btw-return to go back to the main session.", "info");
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		// ctx is invalidated during session replacement; only reset in-memory state.
		// The parent marker is re-read from the session on the next session_start.
		btwParent = null;
		returned = false;
	});
}
