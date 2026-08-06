#!/usr/bin/env bash
# run-check.sh — have the CHECK model (a different model) review an answer.
#
# Usage: run-check.sh <task-file> <answer-file> <check-model> [thinking-level]
#   task-file    : file containing the original task as given by the user
#   answer-file  : file containing the candidate answer produced by the main model
#   check-model  : "provider/model" id, e.g. minimax-cn/MiniMax-M3
#   thinking-level: low (default) | off | minimal | medium | high | xhigh | max
#                  (reasoning checkers are more reliable with thinking enabled; use high/medium
#                   for the strictest review, off for the fastest)
#
# Prints a single-line JSON verdict on stdout:
#   {"verdict":"pass"|"fail","score":0-100,"issues":[...],"suggestions":[...],"explanation":"..."}
# Exit codes: 0 = verdict produced, 3 = verdict could not be parsed/validated,
#             non-zero = sub-process failure (retry once, then abort).

set -euo pipefail

TASK_FILE="$1"
ANSWER_FILE="$2"
CHECK_MODEL="$3"
THINKING="${4:-low}"

PI_BIN="${PI_BIN:-pi}"

if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "error: pi CLI not found on PATH (override with PI_BIN)" >&2
  exit 2
fi
for f in "$TASK_FILE" "$ANSWER_FILE"; do
  [ -f "$f" ] || { echo "error: file not found: $f" >&2; exit 2; }
done

# Warn (not fail) if the check model equals the main model.
if [ -n "${PI_MODEL:-}" ] && [ "$CHECK_MODEL" = "$PI_MODEL" ]; then
  echo "warning: check model equals the main model ($PI_MODEL); a different model is preferred" >&2
fi

TMP_PROMPT="$(mktemp -t dc-check-prompt.XXXXXX.txt)"
trap 'rm -f "$TMP_PROMPT"' EXIT

{
  echo "# Task (as given by the user)"
  cat "$TASK_FILE"
  echo
  echo "# Candidate answer (produced by the main model)"
  cat "$ANSWER_FILE"
  echo
} > "$TMP_PROMPT"

REVIEWER_SYSTEM='You are an independent, rigorous reviewer/checker model. Your ONLY job is to CHECK the candidate answer against the task. Do NOT rewrite the answer and do NOT solve the task yourself. Evaluate: correctness, completeness, consistency, factual accuracy, and whether the answer fully satisfies the task. Then reply with exactly ONE single-line JSON object matching this schema: {"verdict":"pass" or "fail","score":0 to 100,"issues":["specific problem 1", "..."],"suggestions":["specific fix 1", "..."],"explanation":"1-2 sentence summary"}. Set "verdict" to "fail" if the answer has any material error, gap, or does not fully satisfy the task. Be strict but fair, and make issues/suggestions concrete and actionable. Output ONLY the JSON object — no markdown fences, no preamble, no extra text.'

extract_json() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import sys, re, json
data = sys.stdin.read()
matches = list(re.finditer(r"\{.*\}", data, re.S))
obj = None
for m in reversed(matches):
    try:
        obj = json.loads(m.group(0))
        break
    except Exception:
        continue
if not isinstance(obj, dict):
    sys.exit(3)
v = str(obj.get("verdict", "")).strip().lower()
if v not in ("pass", "fail"):
    sys.exit(3)
obj["verdict"] = v
print(json.dumps(obj, ensure_ascii=False))
'
  else
    # Fallback: checker is instructed to emit a single-line JSON object.
    tail -1 | sed -n 's/.*\({.*}\).*/\1/p'
  fi
}

"$PI_BIN" -p --no-session --no-skills --no-extensions --no-prompt-templates --no-themes \
  --no-context-files --no-tools --offline \
  --thinking "$THINKING" \
  --model "$CHECK_MODEL" \
  --system-prompt "$REVIEWER_SYSTEM" \
  "@$TMP_PROMPT" 2>/dev/null | extract_json
