#!/bin/bash
# bd-doctor.sh — diagnose and recover from bd dolt CLI failures.
#
# Symptom (adj-zrr1c): `bd list` returns
#   "failed to open database: dolt circuit breaker is open: server appears down"
# or
#   "database \"beads_adj\" not found on Dolt server at 127.0.0.1:PORT"
#
# Two root causes:
#   1. .beads/dolt-server.{port,pid} files are stale — point at a dead process
#      or wrong port. bd CLI reads them blindly and never probes.
#   2. The named port slot has been taken by ANOTHER project's dolt-server,
#      so bd CLI hits the wrong server and gets "database not found".
#
# What this script does:
#   - Detects both situations
#   - Auto-fixes situation #1 by writing correct port/pid for the real
#     adjutant dolt server (if one exists in this directory's data dir)
#   - For situation #2, prints exactly what to kill/restart with no
#     destructive defaults
#   - Idempotent: running it on a healthy system is a no-op + green check
#
# Usage:
#   ./scripts/bd-doctor.sh              # diagnose + auto-repair stale files
#   ./scripts/bd-doctor.sh --check      # diagnose only, exit 1 if unhealthy
#   ./scripts/bd-doctor.sh --restart    # also restart the adjutant dolt server

set -u
CHECK_ONLY=0
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --check)   CHECK_ONLY=1 ;;
    --restart) RESTART=1 ;;
    --help|-h) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
BD_DIR="$REPO_ROOT/.beads"

if [ ! -d "$BD_DIR" ]; then
  echo "FAIL: no .beads/ directory at $REPO_ROOT — wrong CWD?" >&2
  exit 1
fi

green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }

# initial_bd_ok: does `bd` actually work right now, BEFORE we touch anything?
# bd can serve requests via embedded mode even when no dolt sql-server process
# is running, so server-process discovery alone gives false "unhealthy" verdicts.
# This is the doctor's real health gate. Test seam: BD_DOCTOR_INITIAL_BD_OK=1
# forces healthy, =0 forces broken; unset → real probe.
initial_bd_ok() {
  case "${BD_DOCTOR_INITIAL_BD_OK:-}" in
    1) return 0 ;;
    0) return 1 ;;
    *) bd list --limit 1 --status open >/dev/null 2>&1 ;;
  esac
}

# bd_ok: post-repair health probe. The BD_DOCTOR_SKIP_BD_VERIFY test seam bypasses
# the real `bd` CLI (an external dependency) so the repair logic can be exercised
# in isolation. Unset in production — real runs always probe bd.
bd_ok() {
  [ -n "${BD_DOCTOR_SKIP_BD_VERIFY:-}" ] && return 0
  bd list --limit 1 --status open >/dev/null 2>&1
}

# ── Phase 1: gather facts ─────────────────────────────────────────────────────
PORT_FILE_VAL=""
PID_FILE_VAL=""
[ -f "$BD_DIR/dolt-server.port" ] && PORT_FILE_VAL="$(cat "$BD_DIR/dolt-server.port" 2>/dev/null | tr -d '[:space:]')"
[ -f "$BD_DIR/dolt-server.pid" ]  && PID_FILE_VAL="$(cat "$BD_DIR/dolt-server.pid" 2>/dev/null | tr -d '[:space:]')"

echo "bd-doctor: repo=$REPO_ROOT"
echo "  port file: ${PORT_FILE_VAL:-<missing>}"
echo "  pid  file: ${PID_FILE_VAL:-<missing>}"

# ── Phase 1.5: if bd already works, the system is healthy regardless of dolt
# server topology (bd may be using embedded mode). The doctor only intervenes
# when bd is actually broken — otherwise it would cry wolf and prompt needless
# restarts. This makes the verdict match what the user actually experiences.
if initial_bd_ok; then
  green "bd CLI is healthy — nothing to do."
  exit 0
fi
yellow "bd CLI is NOT responding — investigating dolt server state..."

ADJUTANT_DOLT_PID=""
ADJUTANT_DOLT_PORT=""

# Test seam: BD_DOCTOR_DOLT_OVERRIDE="<pid> <port> <cwd>" injects the discovered
# dolt server, bypassing the ps/lsof scan (external deps). Unset in production.
if [ -n "${BD_DOCTOR_DOLT_OVERRIDE:-}" ]; then
  read -r _ovr_pid _ovr_port _ovr_cwd <<< "$BD_DOCTOR_DOLT_OVERRIDE"
  echo "  found dolt processes (override):"
  echo "    pid=${_ovr_pid:-?} port=${_ovr_port:-?} cwd=${_ovr_cwd:-?}"
  if [ -n "${_ovr_cwd:-}" ] && [[ "$_ovr_cwd" == "$BD_DIR"* ]]; then
    ADJUTANT_DOLT_PID="$_ovr_pid"
    ADJUTANT_DOLT_PORT="$_ovr_port"
  fi
else
  # Find ALL dolt sql-server processes
  ALL_DOLTS=$(ps -axo pid,command 2>/dev/null | grep -E "dolt sql-server" | grep -v grep | awk '{print $1}' | head -10)
  if [ -z "$ALL_DOLTS" ]; then
    red "FAIL: no dolt sql-server process running anywhere"
    echo "  Recovery: re-init bd (bd init) or restart your dev environment."
    exit 1
  fi

  # For each dolt process, figure out its data directory (--data-dir flag or CWD)
  # and the port it's listening on.
  echo "  found dolt processes:"
  for pid in $ALL_DOLTS; do
    # Listening port — `-a` is REQUIRED so `-p` ANDs with `-iTCP -sTCP:LISTEN`.
    # Without `-a`, lsof ORs the selectors and returns ALL processes' ports too.
    # Also filter by $2 == pid as belt-and-braces.
    port="$(lsof -anP -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk -v p="$pid" '$2 == p {split($9, a, ":"); print a[length(a)]; exit}')"
    # CWD as a proxy for which project this dolt belongs to (dolt typically chdirs to data-dir)
    pwdir="$(lsof -p "$pid" 2>/dev/null | awk -v p="$pid" '$2 == p && $4 == "cwd" {print $NF; exit}')"
    echo "    pid=$pid port=${port:-?} cwd=${pwdir:-?}"
    # Heuristic: dolt for THIS project should have cwd containing .beads/dolt or be the .beads dir
    if [ -n "$pwdir" ] && [[ "$pwdir" == "$BD_DIR"* ]]; then
      ADJUTANT_DOLT_PID="$pid"
      ADJUTANT_DOLT_PORT="$port"
    fi
  done
fi

# ── Phase 2: diagnose ─────────────────────────────────────────────────────────
if [ -z "$ADJUTANT_DOLT_PID" ]; then
  red "DIAGNOSIS: no dolt server is serving the adjutant database"
  echo "  No dolt process has a cwd under $BD_DIR"
  if [ -n "$PORT_FILE_VAL" ]; then
    echo "  Stale port file still says: $PORT_FILE_VAL (points at $(nc -z 127.0.0.1 "$PORT_FILE_VAL" 2>&1 >/dev/null && echo "a live but wrong-project dolt" || echo "nothing"))"
  fi
  echo ""
  yellow "RECOVERY OPTIONS:"
  echo "  1) Restart full dev stack:   ./scripts/dev.sh"
  echo "  2) Or just bd dolt:          (from $REPO_ROOT) bd dolt start"
  echo "  3) After bd dolt is running, re-run this script to verify."
  exit 1
fi

green "Adjutant dolt server is alive: pid=$ADJUTANT_DOLT_PID port=$ADJUTANT_DOLT_PORT"

# ── Phase 3: repair stale files ──────────────────────────────────────────────
NEED_FIX=0
[ "$PORT_FILE_VAL" != "$ADJUTANT_DOLT_PORT" ] && NEED_FIX=1
[ "$PID_FILE_VAL"  != "$ADJUTANT_DOLT_PID"  ] && NEED_FIX=1

if [ "$NEED_FIX" -eq 0 ]; then
  green "Port/pid files match reality — nothing to fix."
  # Final verification: does bd actually work?
  if bd_ok; then
    green "bd CLI works — system is healthy."
    exit 0
  fi
  red "WARN: bd CLI still reports failure despite matching files. Investigate."
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  red "STALE FILES detected. Re-run without --check to repair."
  exit 1
fi

yellow "STALE FILES — repairing:"
printf "%s" "$ADJUTANT_DOLT_PORT" > "$BD_DIR/dolt-server.port.new" && mv "$BD_DIR/dolt-server.port.new" "$BD_DIR/dolt-server.port"
printf "%s" "$ADJUTANT_DOLT_PID"  > "$BD_DIR/dolt-server.pid.new"  && mv "$BD_DIR/dolt-server.pid.new"  "$BD_DIR/dolt-server.pid"
green "  wrote .beads/dolt-server.port = $ADJUTANT_DOLT_PORT"
green "  wrote .beads/dolt-server.pid  = $ADJUTANT_DOLT_PID"

# Verify bd works now
if bd_ok; then
  green "bd CLI works — recovery successful."
  exit 0
fi
red "Files fixed but bd still fails. Likely cause: another dolt grabbed the port slot. Check 'bd dolt status' or restart bd dolt manually."
exit 1
