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

heal() { # $1=url  $2=launchd-label
  if curl -fsS -m 6 -o /dev/null "$1" 2>/dev/null; then
    return 0
  fi
  echo "[server-heal] $2 unhealthy ($1) -> kickstart"
  launchctl kickstart -k "gui/$UID_/$2" 2>/dev/null \
    || echo "[server-heal] WARN kickstart failed for $2"
}

heal "http://127.0.0.1:4201/health" "com.adjutant.backend"
heal "http://127.0.0.1:4200/"       "com.adjutant.frontend"
heal "$NGROK_URL"                   "com.adjutant.ngrok"

echo "[server-heal] checked at $(date '+%F %T')"
