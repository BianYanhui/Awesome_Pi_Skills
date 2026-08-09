// pi-from-codex — slash commands ported from OpenAI Codex.
//
// Registers /goal, /btw (+ /btw-return), /review, /diff (+ /diff-clear),
// /plan, plus the goal_get / goal_status_line / goal_complete agent tools.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import btwExtension from "../src/btw.js";
import diffExtension from "../src/diff.js";
import goalExtension from "../src/goal/index.js";
import planExtension from "../src/plan.js";
import reviewExtension from "../src/review.js";

export default function piFromCodex(pi: ExtensionAPI) {
	goalExtension(pi);
	btwExtension(pi);
	reviewExtension(pi);
	diffExtension(pi);
	planExtension(pi);
}
