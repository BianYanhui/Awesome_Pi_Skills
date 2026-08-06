#!/usr/bin/env bash
# pick-check-model.sh — choose the best "checker" model for the double-check skill.
#
# Rules (in priority order):
#   1. The checker MUST be different from the main model (given as $1, else $PI_MODEL).
#   2. Prefer a DIFFERENT provider than the main model.
#   3. Prefer the provider's latest/preferred model:
#        MiniMax  -> MiniMax-M3   (latest MiniMax)
#        DeepSeek -> deepseek-v4-flash  (preferred DeepSeek)
#   4. Fall back to any other available model.
#
# Prints the chosen model as "provider/model" (e.g. minimax-cn/MiniMax-M3) on stdout.
# Exit codes: 0 = found a checker model, 1 = no model other than the main model
#             is available, 2 = usage/environment error.

set -euo pipefail

MAIN_MODEL="${1:-${PI_MODEL:-}}"
PI_BIN="${PI_BIN:-pi}"

if [ -z "$MAIN_MODEL" ]; then
  echo "error: could not determine the main model (pass it as \$1 or set PI_MODEL)" >&2
  exit 2
fi

if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "error: pi CLI not found on PATH (override with PI_BIN)" >&2
  exit 2
fi

case "$MAIN_MODEL" in
  */*) main_provider="${MAIN_MODEL%%/*}"; main_name="${MAIN_MODEL##*/}" ;;
  *)   main_provider=""; main_name="$MAIN_MODEL" ;;
esac

# Preferred latest model id per provider ("" = no preference).
latest_for() {
  case "$1" in
    minimax*)  echo "MiniMax-M3" ;;
    deepseek*) echo "deepseek-v4-flash" ;;
    *)         echo "" ;;
  esac
}

list_models() {
  "$PI_BIN" --list-models 2>/dev/null | awk 'NR > 1 { print $1 "/" $2 }'
}

best="$(list_models | {
  idx=0
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    [ "$m" = "$MAIN_MODEL" ] && continue
    provider="${m%%/*}"
    name="${m#*/}"
    [ "$name" = "$main_name" ] && continue  # same model, any provider prefix
    idx=$((idx + 1))
    score=0
    if [ -z "$main_provider" ] || [ "$provider" != "$main_provider" ]; then
      score=$((score + 10))  # different provider
    fi
    want="$(latest_for "$provider")"
    if [ -n "$want" ] && [ "$name" = "$want" ]; then
      score=$((score + 5))                                        # provider-preferred latest
    fi
    printf '%d|%d|%s\n' "$score" "$idx" "$m"
  done
} | sort -t'|' -k1,1rn -k2,2n | head -1 | cut -d'|' -f3)"

if [ -z "$best" ]; then
  echo "error: no model different from '$MAIN_MODEL' is available to use as the checker" >&2
  exit 1
fi

echo "main model: $MAIN_MODEL -> check model: $best" >&2
printf '%s\n' "$best"
