#!/bin/bash
# persona-inject.sh — Inject persona context into Claude Code sessions.
#
# This hook is registered as a SessionStart hook in .claude/settings.json.
# It fires on:
#   1. Initial session start (no matcher) — injects persona prompt on first load
#   2. After context compaction (matcher: "compact") — re-injects persona prompt
#
# The hook reads the ADJUTANT_PERSONA_ID environment variable (set by the
# lifecycle manager at spawn time) and fetches the generated prompt from
# the Adjutant API. The prompt is written to stdout, which Claude Code
# appends to the session context.
#
# If ADJUTANT_PERSONA_ID is not set (non-persona agent), the hook exits
# silently with no output, which is a no-op for Claude Code.
#
# Dependencies: curl, jq (both standard on macOS)

PERSONA_ID="${ADJUTANT_PERSONA_ID:-}"
API_BASE="${ADJUTANT_API_BASE:-http://localhost:4201}"

# No persona configured — exit silently (no-op)
if [ -z "$PERSONA_ID" ]; then
  exit 0
fi

# Fetch the generated prompt from the Adjutant API
RESPONSE=$(curl -s --max-time 5 "$API_BASE/api/personas/$PERSONA_ID/prompt" 2>/dev/null)

# Check if curl succeeded and response contains data
if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
  exit 0
fi

# Extract the prompt from the JSON response using jq
# Response shape: { success: true, data: { prompt: "..." } }
PROMPT=$(echo "$RESPONSE" | jq -r '.data.prompt // empty' 2>/dev/null)

# Output the prompt to stdout (Claude Code injects this into context)
if [ -n "$PROMPT" ]; then
  echo "$PROMPT"
fi
