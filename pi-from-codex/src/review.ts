// `/review` — review the current working-tree changes.
// Methodology ported from Codex's review-agent skill
// (codex-rs/skills/src/assets/samples/review-agent/SKILL.md):
// read-only, defect-first, P0–P3 priorities, only flag real actionable
// findings introduced by the change.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectDiff, renderUntracked } from "./git.js";

export const REVIEW_TASK_TYPE = "pi-from-codex-review-task";

const MAX_DIFF_CHARS = 180_000;

const REVIEW_INSTRUCTIONS = `Perform a read-only, defect-first review of the requested code change and return every actionable finding.

Review rules:
1. Read the applicable AGENTS.md instructions.
2. Inspect the complete diff and enough surrounding code to understand each changed path.
3. Identify concrete regressions introduced by the change; continue through the whole diff after the first issue.
4. Check relevant tests and call sites to confirm each finding is real and actionable.

Flag an issue only when ALL of these hold:
- It affects correctness, security, performance, or maintainability meaningfully.
- It is discrete and actionable.
- It was introduced by the reviewed change.
- The affected scenario or call path can be demonstrated from the code.
- The author would probably fix it if they knew.

Do NOT flag speculative concerns, pre-existing problems, intentional behavior changes, or style nits.

Write the result with findings first, ordered by severity, one entry per issue:
[P1] Imperative finding title — path/to/file.rs:line
Follow the title with one short paragraph explaining the affected scenario and why the behavior is wrong.
Priorities: P0 = universal release blocker / critical failure; P1 = urgent defect; P2 = ordinary defect; P3 = low-impact but worth fixing.
If there are no qualifying findings, say "No findings." Then add a brief overall assessment and mention material test gaps or residual risks.`;

export default function reviewExtension(pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description: "Review my current changes and find issues (Codex /review)",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const cached = parts.includes("--cached");
			const paths = parts.filter((part) => !part.startsWith("-"));

			const { diff, untracked, error } = collectDiff(ctx.cwd, { cached, paths });
			if (error) {
				ctx.ui.notify(error, "error");
				return;
			}

			let body = diff;
			let truncated = false;
			if (!cached && untracked.length > 0) {
				const untrackedText = renderUntracked(ctx.cwd, untracked, MAX_DIFF_CHARS - body.length);
				if (untrackedText.text) {
					if (body) body += "\n";
					body += untrackedText.text;
					if (untrackedText.truncated) truncated = true;
				}
			}

			const scope = cached ? "staged changes" : "working-tree changes";
			if (!body.trim()) {
				ctx.ui.notify(`No ${scope} to review.`, "info");
				return;
			}

			let diffSection = body;
			if (body.length > MAX_DIFF_CHARS) {
				diffSection = body.slice(0, MAX_DIFF_CHARS);
				truncated = true;
			}

			const content =
				`Review the ${scope}${paths.length > 0 ? ` for paths: ${paths.join(", ")}` : ""}.\n\n` +
				REVIEW_INSTRUCTIONS +
				`\n\n## Diff\n\n\`\`\`diff\n${diffSection}\n\`\`\`\n` +
				(truncated
					? `\n(The diff was truncated. If you need more, read the files directly with the read tool, or run git diff yourself.)\n`
					: "");

			ctx.ui.notify(`Reviewing ${scope}${truncated ? " (truncated diff)" : ""}…`, "info");
			pi.sendMessage(
				{
					customType: REVIEW_TASK_TYPE,
					content,
					display: false,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		},
	});
}
