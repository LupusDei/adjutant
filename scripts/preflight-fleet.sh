#!/usr/bin/env bash
# preflight-fleet.sh — refuse to start a SECOND Adjutant fleet (adj-z9dqs).
#
# WHY THIS EXISTS (2026-09-02 fleet-down incident):
#   launchd already supervises com.adjutant.backend (:4201) and
#   com.adjutant.frontend (:4200). Someone additionally ran ./scripts/dev.sh,
#   which starts its own Vite. 4200 was taken, so that Vite fell back to :4201
#   and bound IPv6 (::1). `localhost` resolves ::1 first, so every MCP/REST call
#   to localhost:4201 hit Vite and got index.html back — ENDPOINT_NOT_FOUND for
#   every agent, 0 live agents. 127.0.0.1:4201/health stayed green throughout,
#   which is exactly why nothing looked down.
#
# Two independent signals, because either alone has a blind spot:
#   1. launchd job state — catches a supervised fleet whose ports are momentarily
#      free (mid-restart), which a port probe would wave through.
#   2. Listening ports across ALL address families — catches a stray unsupervised
#      process, and (critically) an IPv6-ONLY listener that a 127.0.0.1 probe
#      would call "free". That blind spot IS the incident.
#
# Exit 0 = safe to start. Exit 1 = something is already running; do not start.
#
# Environment:
#   ADJUTANT_BACKEND_PORT        backend port to check      (default 4201)
#   ADJUTANT_FRONTEND_PORT       frontend port to check     (default 4200)
#   ADJUTANT_LAUNCHD_LABELS      space-separated job labels (default the two above)
#   ADJUTANT_LAUNCHCTL_BIN       launchctl binary           (default `launchctl`)
#   ADJUTANT_ALLOW_DUPLICATE_DEV set to 1 to bypass entirely (you own the outcome)
set -uo pipefail

BACKEND_PORT="${ADJUTANT_BACKEND_PORT:-4201}"
FRONTEND_PORT="${ADJUTANT_FRONTEND_PORT:-4200}"
LAUNCHD_LABELS="${ADJUTANT_LAUNCHD_LABELS:-com.adjutant.backend com.adjutant.frontend}"
LAUNCHCTL_BIN="${ADJUTANT_LAUNCHCTL_BIN:-launchctl}"

if [ "${ADJUTANT_ALLOW_DUPLICATE_DEV:-}" = "1" ] || [ "${ADJUTANT_ALLOW_DUPLICATE_DEV:-}" = "true" ]; then
  echo "[preflight] ADJUTANT_ALLOW_DUPLICATE_DEV set — skipping the duplicate-fleet check." >&2
  exit 0
fi

# ONE snapshot of every listening TCP socket, taken up front. netstat/ss cost
# ~10ms for the whole table; `lsof -iTCP:<port>` costs ~600ms PER PORT because
# it walks every process's file descriptors. Same answer, 60x cheaper, and the
# cost stays flat if more ports are ever checked.
#
# In all three tools the local address is field 4 — macOS `*.4201`, Linux
# `0.0.0.0:4201`, IPv6 `::1.4201` / `[::1]:4201` — so one awk suffix match on
# `[.:]<port>` covers every family without any name resolution.
listening_snapshot() {
  if command -v netstat >/dev/null 2>&1; then
    netstat -an -p tcp 2>/dev/null | grep LISTEN && return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null && return 0
  fi
  return 1
}

LISTENERS="$(listening_snapshot)"
HAVE_SNAPSHOT=$?

# Is anything LISTENING on this port, on any address family?
port_in_use() {
  local port="$1" host
  if [ $HAVE_SNAPSHOT -eq 0 ]; then
    printf '%s\n' "$LISTENERS" | awk -v p="$port" '$4 ~ ("[.:]" p "$") { found = 1 } END { exit !found }' && return 0
    return 1
  fi
  # No listing tool: probe each loopback family explicitly rather than trusting
  # `localhost` to resolve to the family that is squatting — that assumption is
  # precisely what hid the incident.
  for host in 127.0.0.1 ::1 localhost; do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
      exec 3<&- 3>&-
      return 0
    fi
  done
  return 1
}

# A launchd job counts as running only when it reports a PID. Loaded-but-stopped
# jobs (no PID) are not serving anything and must not block a dev start.
job_running() {
  local label="$1" listing
  listing="$("$LAUNCHCTL_BIN" list "$label" 2>/dev/null)" || return 1
  printf '%s' "$listing" | grep -q '"PID"'
}

CONFLICTS=()

for label in $LAUNCHD_LABELS; do
  if job_running "$label"; then
    CONFLICTS+=("launchd job '$label' is loaded and running")
  fi
done

for entry in "backend:$BACKEND_PORT" "frontend:$FRONTEND_PORT"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  if port_in_use "$port"; then
    CONFLICTS+=("$name port $port already has a listener")
  fi
done

if [ ${#CONFLICTS[@]} -eq 0 ]; then
  exit 0
fi

{
  echo ""
  echo "REFUSING TO START — an Adjutant fleet is already running (adj-z9dqs)."
  echo ""
  for conflict in "${CONFLICTS[@]}"; do
    echo "  - $conflict"
  done
  echo ""
  echo "Starting a second stack is how the fleet went down on 2026-09-02: the"
  echo "duplicate Vite could not get $FRONTEND_PORT, fell back to $BACKEND_PORT, bound IPv6, and"
  echo "shadowed the backend for every client that resolves localhost to ::1."
  echo ""
  echo "What to do instead:"
  echo "  - Use the supervised fleet that is already up (http://localhost:$FRONTEND_PORT)."
  echo "  - Restart it:  launchctl kickstart -k gui/\$UID/com.adjutant.backend"
  echo "  - Stop it first if you really want a foreground dev stack:"
  echo "      launchctl bootout gui/\$UID/com.adjutant.backend gui/\$UID/com.adjutant.frontend"
  echo "  - Override (you own the outcome):  ADJUTANT_ALLOW_DUPLICATE_DEV=1 ./scripts/dev.sh"
  echo ""
} >&2

exit 1
