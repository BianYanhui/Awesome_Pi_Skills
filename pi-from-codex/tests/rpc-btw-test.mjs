// RPC smoke test for /btw session switching + stale-ctx fix.
// Run: node tests/rpc-btw-test.mjs
import { spawn } from "node:child_process";
import { join } from "node:path";

const PI = process.argv[2] ?? "pi";
const EXT = join(process.cwd(), "extensions");

const child = spawn(PI, ["--offline", "--no-extensions", "--extension", EXT, "--mode", "rpc"], {
	stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const all = [];
let errors = [];
let statusKeys = [];

child.stdout.on("data", (chunk) => {
	buffer += chunk.toString();
	let idx;
	while ((idx = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, idx);
		buffer = buffer.slice(idx + 1);
		if (!line.trim()) continue;
		try {
			const evt = JSON.parse(line);
			all.push(evt);
			if (evt.type === "extension_error") {
				errors.push(evt);
				console.log(`[extension_error] event=${evt.event} error=${String(evt.error).slice(0, 100)}`);
			}
			if (evt.type === "extension_ui_request" && evt.method === "setStatus") {
				statusKeys.push(evt.statusKey);
			}
			if (evt.type === "extension_ui_request" && evt.method === "notify") {
				console.log(`[notify] ${evt.message}`);
			}
		} catch {
			// partial line
		}
	}
});
child.stderr.on("data", (chunk) => process.stderr.write(`[stderr] ${chunk}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(obj) {
	child.stdin.write(JSON.stringify(obj) + "\n");
}

// Phase 1: wait for startup extension UI (extensions loaded)
for (let i = 0; i < 50 && statusKeys.length === 0; i++) await sleep(100);

console.log("--- extensions loaded; sending /btw ---");
const errorsBefore = errors.length;
send({ type: "prompt", message: "/btw" });
await sleep(2500);
console.log("--- after /btw ---");

const staleErrorsAfterBtw = errors.filter((e) => e.event === "session_shutdown" && String(e.error).includes("stale"));
if (staleErrorsAfterBtw.length === 0) {
	console.log("PASS: no stale-ctx session_shutdown errors during /btw switch");
} else {
	console.log(`FAIL: ${staleErrorsAfterBtw.length} stale-ctx errors during /btw switch`);
}

const notifyAfterBtw = all.filter((e) => e.type === "extension_ui_request" && e.method === "notify" && String(e.message).includes("side conversation"));
if (notifyAfterBtw.length > 0) {
	console.log("PASS: side-conversation notification emitted in new session");
} else {
	console.log("FAIL: no side-conversation notification after /btw");
}

// Phase 2: return
console.log("--- sending /btw-return ---");
send({ type: "prompt", message: "/btw-return" });
await sleep(2500);
console.log("--- after /btw-return ---");
const staleErrorsAfterReturn = errors.filter((e) => e.event === "session_shutdown" && String(e.error).includes("stale"));
if (staleErrorsAfterReturn.length === errorsBefore) {
	console.log("PASS: no NEW stale-ctx errors during /btw-return switch");
} else {
	console.log(`FAIL: ${staleErrorsAfterReturn.length - errorsBefore} new stale-ctx errors during /btw-return`);
}

const ok = staleErrorsAfterBtw.length === 0 && notifyAfterBtw.length > 0 && staleErrorsAfterReturn.length === errorsBefore;
child.kill();
console.log(ok ? "RPC TEST PASS" : "RPC TEST FAIL");
process.exit(ok ? 0 : 1);
