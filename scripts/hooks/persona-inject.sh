#!/bin/bash
# persona-inject.sh — Inject persona context into Claude Code sessions (adj-j0jpz).
#
# Registered as a SessionStart hook in .claude/settings.json under BOTH matchers:
#   1. ""        — initial session start: inject persona on first load
#   2. "compact" — after context compaction: re-inject so the persona survives compaction
#
# SOURCE OF TRUTH IS THE BACKEND, NOT AN ON-DISK FILE.
# The old version read <project>/.claude/agents/<name>.md, which is adjutant-repo-local
# (gitignored, written to the wrong dir for worktree agents) — so it silently no-op'd for
# every agent spawned outside the adjutant repo. This version resolves the persona from the
# backend by the agent's callsign, so it works in ANY project/worktree with zero dependency
# on local files. The on-disk agent file is now just a spawn-time cache, not the source.
#
# It prints the persona prompt to stdout, which Claude Code appends to session context.
#
# LOUD-ON-FAILURE (adj-j0jpz RC3): a genuine "no persona assigned" (HTTP 404) is silent —
# that is the legitimate generic-agent state. But if a persona IS assigned
# (ADJUTANT_PERSONA_ID set) and delivery fails (backend unreachable / 5xx), it prints a loud
# warning INTO the session instead of exiting silently, so a regression here is never again
# invisible the way it was when a whole session ran generic without anyone noticing.

set -u

AGENT_ID="${ADJUTANT_AGENT_ID:-}"
# Not a spawned adjutant agent (no callsign in env) — nothing to inject.
[ -z "$AGENT_ID" ] && exit 0

# Resolve the backend origin: explicit env override, else the adjutant server URL in the
# project's .mcp.json (honors a custom port), else the localhost default.
BACKEND=""
if [ -n "${ADJUTANT_BACKEND_URL:-}" ]; then
  BACKEND="${ADJUTANT_BACKEND_URL%/}"
elif [ -f ".mcp.json" ] && command -v node >/dev/null 2>&1; then
  BACKEND="$(node -e 'try{const u=require("./.mcp.json").mcpServers?.adjutant?.url||"";process.stdout.write(u?new URL(u).origin:"")}catch(e){}' 2>/dev/null)"
fi
[ -z "$BACKEND" ] && BACKEND="http://localhost:4201"

URL="$BACKEND/api/agents/$AGENT_ID/persona-prompt"

# Fetch. -s silent, -m timeout, capture body + trailing HTTP code.
RESP="$(curl -s -m 5 -w $'\n%{http_code}' "$URL" 2>/dev/null)"
CURL_RC=$?
CODE="$(printf '%s' "$RESP" | tail -n1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"

if [ "$CODE" = "200" ]; then
  # Emit the rendered persona prompt (data.prompt) into the session context.
  printf '%s' "$BODY" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const p=JSON.parse(s);const t=p?.data?.prompt||p?.prompt;if(t){process.stdout.write(t)}}catch(e){}
    })' 2>/dev/null
  exit 0
fi

if [ "$CODE" = "404" ]; then
  # No persona linked to this callsign — legitimate generic agent. Stay silent.
  exit 0
fi

# Delivery failed (backend unreachable / 5xx / non-JSON). If a persona IS known to be
# assigned (ADJUTANT_PERSONA_ID set), make it LOUD — never swallow it.
if [ -n "${ADJUTANT_PERSONA_ID:-}" ]; then
  echo "⚠️  PERSONA NOT LOADED — the backend has persona ${ADJUTANT_PERSONA_ID} assigned to"
  echo "    agent '${AGENT_ID}', but it could not be fetched (HTTP '${CODE:-none}', curl rc=${CURL_RC}) from:"
  echo "        ${URL}"
  echo "    You are running WITHOUT your persona. Verify the backend is up, then run"
  echo "    'adjutant doctor' in this project to diagnose persona-injection wiring."
fi
exit 0
