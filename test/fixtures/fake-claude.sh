#!/bin/bash
# Stand-in for `claude -p --output-format json` in tests.
#   FAKE_CLAUDE_DIR    where argv/stdin/env are recorded (required)
#   FAKE_CLAUDE_MODE   ok | error | ratelimit | slow
#   FAKE_CLAUDE_QUEUE  optional dir of numbered *.json replies, consumed in order
dir="${FAKE_CLAUDE_DIR:?}"
n=$(ls "$dir"/argv-*.txt 2>/dev/null | wc -l | tr -d ' ')
printf '%s\n' "$@" > "$dir/argv-$n.txt"
cat > "$dir/stdin-$n.txt"
printf '%s' "${ANTHROPIC_API_KEY:-}" > "$dir/apikey-$n.txt"
case "${FAKE_CLAUDE_MODE:-ok}" in
  error) echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Something broke"}'; exit 1 ;;
  ratelimit) echo '{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1760000000"}'; exit 1 ;;
  slow) sleep 5; echo '{}'; exit 0 ;;
esac
if [ -n "${FAKE_CLAUDE_QUEUE:-}" ]; then
  next=$(ls "$FAKE_CLAUDE_QUEUE"/*.json 2>/dev/null | sort | head -1)
  if [ -n "$next" ]; then cat "$next"; rm -f "$next"; exit 0; fi
fi
echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"answer\":42}","structured_output":{"answer":42},"total_cost_usd":0.0123,"duration_ms":7,"usage":{"input_tokens":120,"cache_read_input_tokens":30,"cache_creation_input_tokens":0,"output_tokens":45}}'
