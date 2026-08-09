// Shared test harness: loads the extension with Pi's own loader and provides
// a mock ctx with recording stubs for fork/switchSession/sendMessage/etc.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const require = createRequire(import.meta.url);
export const PACKAGE_ROOT = (() => {
	const selfPath = dirname(fileURLToPath(import.meta.url));
	return selfPath.endsWith("/tests") ? dirname(selfPath) : selfPath;
})();
export const EXTENSION_PATH = join(PACKAGE_ROOT, "extensions", "index.ts");

const PI_EXTENSION_LOADER_PATH = resolvePiExtensionLoaderPath();
const { loadExtensions } = await import(pathToFileURL(PI_EXTENSION_LOADER_PATH).href);

export interface HarnessOptions {
	entries?: SessionEntryLike[];
	idle?: boolean;
	pendingMessages?: boolean;
	sessionFile?: string;
	leafId?: string | null;
}

export interface CommandEntry {
	name: string;
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
}

export interface ToolEntry {
	name: string;
	definition: {
		execute: (id: string, params: unknown, ...rest: unknown[]) => Promise<{ content: { type: string; text: string }[]; details?: unknown; isError?: boolean }>;
	};
}

export interface SessionEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
	message?: { role: string; content: unknown; usage?: Record<string, number> };
	summary?: string;
	tokensBefore?: number;
	timestamp?: string;
}

export interface HarnessReturn {
	result: { errors: unknown[]; extensions: unknown[] };
	extension: {
		commands: Map<string, CommandEntry>;
		tools: Map<string, ToolEntry>;
		handlers: Map<string, unknown[]>;
	};
	ctx: Record<string, unknown>;
	sentMessages: { message: { customType: string; content: string; display?: boolean; details?: Record<string, unknown> }; options?: Record<string, unknown> }[];
	entries: SessionEntryLike[];
	notifications: { message: string; type: string }[];
	statuses: { key: string; text: string | undefined }[];
	widgets: { key: string; lines: unknown; options: unknown }[];
	newSessions: { options?: unknown }[];
	forks: { entryId: string; options?: unknown }[];
	switches: { sessionPath: string; options?: unknown }[];
	setIdle: (value: boolean) => void;
	setPendingMessages: (value: boolean) => void;
	command: (name: string) => CommandEntry | undefined;
	tool: (name: string) => ToolEntry["definition"] | undefined;
	emit: (name: string, event?: Record<string, unknown>) => Promise<void>;
	appendEntry: (customType: string, data: unknown) => void;
}

function resolvePiExtensionLoaderPath(): string {
	const localLoaderPath = join(PACKAGE_ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "index.js");
	try {
		require.resolve(localLoaderPath);
		return localLoaderPath;
	} catch {
		const globalNodeModules = execFileSync("npm", ["root", "-g"], { encoding: "utf8", cwd: PACKAGE_ROOT }).trim();
		const globalLoaderPath = join(globalNodeModules, "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "index.js");
		if (existsSync(globalLoaderPath)) return globalLoaderPath;
		return "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
	}
}

export async function createHarness(options: HarnessOptions = {}): Promise<HarnessReturn> {
	const result = await loadExtensions([EXTENSION_PATH], PACKAGE_ROOT);
	assert.equal(
		result.errors.length,
		0,
		`extension failed to load: ${JSON.stringify(result.errors)}`,
	);
	const extension = result.extensions[0] as HarnessReturn["extension"];

	const sentMessages: HarnessReturn["sentMessages"] = [];
	const entries: HarnessReturn["entries"] = [...(options.entries ?? [])];
	const notifications: HarnessReturn["notifications"] = [];
	const statuses: HarnessReturn["statuses"] = [];
	const widgets: HarnessReturn["widgets"] = [];
	const forks: HarnessReturn["forks"] = [];
	const switches: HarnessReturn["switches"] = [];
	const newSessions: HarnessReturn["newSessions"] = [];
	let idle = options.idle ?? true;
	let pendingMessages = options.pendingMessages ?? false;

	result.runtime.sendMessage = (message: unknown, sendOptions: unknown) => {
		sentMessages.push({ message, options: sendOptions } as HarnessReturn["sentMessages"][0]);
	};
	result.runtime.appendEntry = (customType: string, data: unknown) => {
		const entry = { type: "custom" as const, customType, data };
		entries.push(entry);
		return entry;
	};

	const ctx: Record<string, unknown> = {
		hasUI: true,
		mode: "tui",
		cwd: PACKAGE_ROOT,
		sessionManager: {
			getEntries: () => entries,
			getBranch: () => entries,
			getLeafId: () => options.leafId ?? "leaf-1",
			getSessionFile: () => options.sessionFile ?? "/tmp/main-session.jsonl",
			appendCustomEntry: (customType: string, data: unknown) => {
				const entry = { type: "custom" as const, customType, data };
				entries.push(entry);
				return "entry-id";
			},
		},
		modelRegistry: {},
		model: undefined,
		isIdle: () => idle,
		hasPendingMessages: () => pendingMessages,
		getContextUsage: () => undefined,
		getSystemPrompt: () => "",
		compact: () => {},
		abort: () => {},
		shutdown: () => {},
		signal: undefined,
		fork: async (entryId: string, options?: unknown) => {
			forks.push({ entryId, options });
			if (options && typeof options === "object" && "withSession" in options) {
				await (options as { withSession?: (replacementCtx: Record<string, unknown>) => Promise<void> }).withSession?.(replacementCtx());
			}
			return { cancelled: false };
		},
		switchSession: async (sessionPath: string, options?: unknown) => {
			switches.push({ sessionPath, options });
			if (options && typeof options === "object" && "withSession" in options) {
				await (options as { withSession?: (replacementCtx: Record<string, unknown>) => Promise<void> }).withSession?.(replacementCtx());
			}
			return { cancelled: false };
		},
		newSession: async (options?: unknown) => {
			newSessions.push({ options });
			if (options && typeof options === "object") {
				const setup = (options as { setup?: (sm: Record<string, unknown>) => Promise<void> }).setup;
				if (setup) {
					await setup({
						appendMessage: (message: unknown) => {
							const entry: SessionEntryLike = { type: "message", message: message as SessionEntryLike["message"] };
							entries.push(entry);
							return "msg-id";
						},
						appendCustomEntry: (customType: string, data: unknown) => {
							const entry: SessionEntryLike = { type: "custom", customType, data };
							entries.push(entry);
							return "entry-id";
						},
					});
				}
				const withSession = (options as { withSession?: (replacementCtx: Record<string, unknown>) => Promise<void> }).withSession;
				if (withSession) await withSession(replacementCtx());
			}
			return { cancelled: false };
		},
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string, type = "info") => notifications.push({ message, type }),
			setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
			setWidget: (key: string, lines: unknown, widgetOptions: unknown) => widgets.push({ key, lines, options: widgetOptions }),
			confirm: async () => true,
			input: async () => undefined,
		},
	};

	function replacementCtx(): Record<string, unknown> {
		return {
			...ctx,
			sessionManager: ctx.sessionManager,
			ui: ctx.ui,
			sendMessage: async (message: unknown, options?: unknown) => {
				sentMessages.push({ message, options } as HarnessReturn["sentMessages"][0]);
			},
			sendUserMessage: async (content: unknown) => {
				sentMessages.push({
					message: { customType: "user", content: String(content), display: true },
					options: { fromBtwFork: true },
				});
			},
		};
	}

	return {
		result,
		extension,
		ctx,
		sentMessages,
		entries,
		notifications,
		statuses,
		widgets,
		newSessions,
		forks,
		switches,
		setIdle: (value: boolean) => {
			idle = value;
		},
		setPendingMessages: (value: boolean) => {
			pendingMessages = value;
		},
		command: (name: string) => extension.commands.get(name),
		tool: (name: string) => extension.tools.get(name)?.definition,
		async emit(name: string, event: Record<string, unknown> = {}) {
			for (const handler of extension.handlers.get(name) ?? []) {
				await (handler as (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void>)({ type: name, ...event }, ctx);
			}
		},
		appendEntry: (customType: string, data: unknown) => {
			entries.push({ type: "custom", customType, data });
		},
	};
}

export function parseToolResponse(response: { content: { type: string; text: string }[] }): Record<string, unknown> {
	const text = response.content[0]?.text;
	if (!text) throw new Error("empty tool response");
	return JSON.parse(text);
}

export function lastEntryOfType<T>(entries: { type: string; customType?: string; data?: unknown }[], customType: string): { data: T } | undefined {
	for (const entry of [...entries].reverse()) {
		if (entry.type === "custom" && entry.customType === customType) {
			return entry as unknown as { data: T };
		}
	}
	return undefined;
}

export function latestGoal(harness: HarnessReturn): { goal: unknown; remainingTokens: number | null } | null {
	const entry = lastEntryOfType(harness.entries, "pi-from-codex-goal-state");
	if (!entry) return null;
	const data = entry.data as { version: number; goal: unknown };
	return data.goal ? ({ goal: data.goal, remainingTokens: null } as never) : null;
}
