// Git helpers shared by /diff and /review.

import { execFileSync, spawnSync } from "node:child_process";

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
}

export function runGit(args: string[], cwd: string): GitResult {
	try {
		const result = spawnSync("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			code: result.status ?? -1,
		};
	} catch (err) {
		return { stdout: "", stderr: err instanceof Error ? err.message : String(err), code: -1 };
	}
}

export function isGitRepo(cwd: string): boolean {
	const result = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
	return result.code === 0 && result.stdout.trim() === "true";
}

/** Paths of untracked files (and dirs), via `git status --porcelain`. */
export function untrackedPaths(cwd: string): string[] {
	const result = runGit(["status", "--porcelain=v1", "--untracked-files=all"], cwd);
	if (result.code !== 0) return [];
	const paths: string[] = [];
	for (const line of result.stdout.split("\n")) {
		if (line.length < 4) continue;
		const code = line.slice(0, 2);
		if (code === "??") paths.push(line.slice(3));
	}
	return paths;
}

/** Working-tree diff for staged + unstaged + untracked changes. */
export function collectDiff(cwd: string, options: { cached?: boolean; stat?: boolean; paths?: string[] } = {}): { diff: string; untracked: string[]; error: string | null } {
	if (!isGitRepo(cwd)) return { diff: "", untracked: [], error: "Not inside a git repository." };
	const args: string[] = ["diff", "--no-ext-diff"];
	if (options.stat) args.push("--stat");
	if (options.cached) args.push("--cached");
	if (options.paths && options.paths.length > 0) args.push("--", ...options.paths);
	const result = runGit(args, cwd);
	if (result.code !== 0) return { diff: "", untracked: [], error: `git diff failed: ${result.stderr.trim() || "unknown error"}` };

	const untracked = options.cached ? [] : untrackedPaths(cwd);
	return { diff: result.stdout, untracked, error: null };
}

const UNTRACKED_HEAD_LINES = 100;
const UNTRACKED_TAIL_LINES = 50;

/** Render untracked files as a pseudo-diff so reviewers see their contents. */
export function renderUntracked(cwd: string, paths: string[], limitLines: number): { text: string; truncated: boolean } {
	const parts: string[] = [];
	let truncated = false;
	for (const path of paths) {
		try {
			const content = execFileSync("cat", [path], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
			const lines = content.split("\n");
			const isHuge = lines.length > UNTRACKED_HEAD_LINES + UNTRACKED_TAIL_LINES;
			const shown = isHuge
				? [...lines.slice(0, UNTRACKED_HEAD_LINES), `… (${lines.length - UNTRACKED_HEAD_LINES - UNTRACKED_TAIL_LINES} lines omitted) …`, ...lines.slice(-UNTRACKED_TAIL_LINES)]
				: lines;
			if (isHuge) truncated = true;
			parts.push(`--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${shown.map((line) => `+${line}`).join("\n")}`);
		} catch {
			parts.push(`--- /dev/null\n+++ b/${path}\n(untracked; unreadable)`);
		}
		if (parts.join("\n").length > limitLines) {
			truncated = true;
			break;
		}
	}
	return { text: parts.join("\n\n"), truncated };
}
