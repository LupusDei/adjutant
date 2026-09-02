#!/usr/bin/env bash
# adjutant-server-heal.sh — self-heal watchdog for the supervised dev servers.
#
# Mirrors ~/.adjutant/dolt-heal.sh (the 2026-06-11 outage fix): launchd KeepAlive
# only restarts on process DEATH, not on a hung-but-listening server, a wedged
# port, or an ABI-mismatched Vite that crash-loops faster than the health window.
# This 120s watchdog curls each endpoint and `launchctl kickstart -k`s any job
# that fails its health probe — closing the "alive process, dead service" gap.
#
# Run via bash (NOT zsh) to avoid noclobber surprises. macOS has no `timeout`, so
# request deadlines use `curl -m`. Source of truth: repo scripts/supervisor/.
set -uo pipefail

UID_=$(id -u)
NGROK_URL="${ADJUTANT_NGROK_URL:-https://cc.jmm.ngrok.io}"

heal() { # $1=url  $2=launchd-label  $3=(optional) substring the body MUST contain
  local body
  if ! body="$(curl -fsS -m 6 "$1" 2>/dev/null)"; then
    echo "[server-heal] $2 unhealthy ($1) -> kickstart"
  elif [ -n "${3:-}" ] && ! printf '%s' "$body" | grep -qF -- "$3"; then
    # Reachable, 200, WRONG SERVICE — the adj-z9dqs shadowing case: a duplicate
    # Vite bound the backend's port and answered /health with index.html.
    echo "[server-heal] $2 SHADOWED ($1 answered, but not by $2) -> kickstart"
  else
    return 0
  fi
  launchctl kickstart -k "gui/$UID_/$2" 2>/dev/null \
    || echo "[server-heal] WARN kickstart failed for $2"
}

# Probe through `localhost`, NOT 127.0.0.1 (adj-z9dqs). Every real client — MCP,
# the dashboard, the CLI — resolves the NAME, and on this box that prefers ::1.
# The 2026-09-02 squatter held only ::1, so a 127.0.0.1 probe was green for the
# entire outage. Probing the name is what makes the watchdog see what agents see;
# the body assertion is what makes a 200 from the WRONG server count as down.
heal "http://localhost:4201/health" "com.adjutant.backend" '"status":"ok"'
heal "http://localhost:4200/"       "com.adjutant.frontend"
heal "$NGROK_URL"                   "com.adjutant.ngrok"

echo "[server-heal] checked at $(date '+%F %T')"
