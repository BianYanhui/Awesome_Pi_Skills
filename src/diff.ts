// `/diff` — show the git diff, including untracked files.
// Ported from Codex's `/diff` command ("show git diff (including untracked files)").

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectDiff, renderUntracked, runGit } from "./git.js";

const MAX_DIFF_CHARS = 240_000;

export default function diffExtension(pi: ExtensionAPI) {
	pi.registerCommand("diff", {
		description: "Show the git diff (including untracked files)",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const cached = parts.includes("--cached");
			const stat = parts.includes("--stat");
			const paths = parts.filter((part) => !part.startsWith("-"));

			const { diff, untracked, error } = collectDiff(ctx.cwd, { cached, stat, paths });
			if (error) {
				ctx.ui.notify(error, "error");
				return;
			}

			let output = diff;
			let truncated = false;
			if (!cached && untracked.length > 0) {
				const untrackedText = renderUntracked(ctx.cwd, untracked, MAX_DIFF_CHARS - output.length);
				if (untrackedText.text) {
					if (output && !stat) output += "\n";
					output += untrackedText.text;
					if (untrackedText.truncated) truncated = true;
				}
			}

			if (output.length > MAX_DIFF_CHARS) {
				output = output.slice(0, MAX_DIFF_CHARS);
				truncated = true;
			}

			if (!output.trim()) {
				ctx.ui.notify(cached ? "No staged changes." : "No changes in the working tree.", "info");
				return;
			}

			if (stat) {
				ctx.ui.notify(output, "info");
				return;
			}

			// Render large diffs in a scrollable widget; short diffs as a notification.
			const lines = output.split("\n");
			const title = `git diff ${cached ? "--cached " : ""}${stat ? "--stat " : ""}${paths.join(" ")}`;
			if (lines.length <= 80) {
				ctx.ui.notify(`\`\`\`\n${title}\n\n${output}\n\`\`\``, "info");
			} else {
				ctx.ui.setWidget("diff", [`${title} (${lines.length} lines${truncated ? ", truncated" : ""})`, ...lines]);
				ctx.ui.notify(`Showing ${lines.length} lines of diff${truncated ? " (truncated)" : ""}. Type anything to dismiss.`, "info");
			}
		},
	});

	// Allow clearing the diff widget if the user wants.
	pi.registerCommand("diff-clear", {
		description: "Dismiss the /diff output widget",
		handler: async (_args, ctx) => {
			ctx.ui.setWidget("diff", undefined);
		},
	});

	// Sanity-check used import.
	void runGit;
}
