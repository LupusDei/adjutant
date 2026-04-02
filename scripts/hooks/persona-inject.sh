#!/bin/bash
# persona-inject.sh — Inject persona context into Claude Code sessions.
#
# This hook is registered as a SessionStart hook in .claude/settings.json.
# It fires on:
#   1. Initial session start (no matcher) — injects persona prompt on first load
#   2. After context compaction (matcher: "compact") — re-injects persona prompt
#
# The hook reads the persona agent file from disk at .claude/agents/<name>.md.
# The agent file name is derived from the --agent flag in the Claude process args.
# If no --agent flag is found, falls back to checking ADJUTANT_AGENT_ID env var.
#
# The prompt is written to stdout, which Claude Code appends to the session context.
#
# If no agent file is found, the hook exits silently (no-op for Claude Code).

# Try to find the agent name from the --agent flag in our parent process args
AGENT_NAME=""
if [ -n "$ADJUTANT_AGENT_ID" ]; then
  # Check if a .claude/agents/ file exists for this agent's callsign
  # The agent file might use a sanitized persona name, not the callsign directly
  # Look for any .md file that was written by the spawn process
  SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  AGENTS_DIR="$SCRIPT_DIR/agents"

  if [ -d "$AGENTS_DIR" ]; then
    # Find the most recently modified agent file (the one written at spawn time)
    # Exclude adjutant.md (coordinator file, not a persona)
    AGENT_FILE=$(find "$AGENTS_DIR" -name "*.md" ! -name "adjutant.md" -newer "$AGENTS_DIR" -print 2>/dev/null | head -1)

    # If no file newer than dir, try getting the agent file from process args
    if [ -z "$AGENT_FILE" ]; then
      # Parse --agent flag from the claude process command line
      AGENT_NAME=$(ps -o args= -p $PPID 2>/dev/null | grep -oE '\-\-agent [a-z0-9-]+' | awk '{print $2}')
      if [ -n "$AGENT_NAME" ] && [ -f "$AGENTS_DIR/$AGENT_NAME.md" ]; then
        AGENT_FILE="$AGENTS_DIR/$AGENT_NAME.md"
      fi
    fi

    if [ -n "$AGENT_FILE" ] && [ -f "$AGENT_FILE" ]; then
      # Read the file, strip YAML frontmatter (between --- delimiters), output the prompt body
      awk 'BEGIN{fm=0} /^---$/{fm++; next} fm>=2||fm==0{print}' "$AGENT_FILE"
      exit 0
    fi
  fi
fi

# No agent file found — exit silently (no-op)
exit 0
