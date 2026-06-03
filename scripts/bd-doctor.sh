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

# Externally-managed mode (adj-182): when .beads/metadata.json carries a
# `dolt_server_port`, a launchd/systemd supervisor owns the one server and bd merely
# connects — it must never spawn or kill it. We detect that mode here and read the
# `project_id` to derive the supervisor label `com.adjutant.dolt.<projectId>`.
META_FILE="$BD_DIR/metadata.json"
EXTERNALLY_MANAGED=0
PROJECT_ID=""
# Minimal, dependency-free JSON scalar extraction (no jq): grab "key": <value>,
# tolerating string or numeric values and surrounding whitespace.
meta_value() {
  # $1 = key name. Echoes the scalar value (unquoted) or empty.
  [ -f "$META_FILE" ] || return 0
  sed -n -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"?([^\",}]+)\"?.*/\1/p" "$META_FILE" \
    | head -1 | tr -d '[:space:]'
}
if [ -f "$META_FILE" ]; then
  _meta_port="$(meta_value 'dolt_server_port')"
  if [ -n "$_meta_port" ]; then
    EXTERNALLY_MANAGED=1
    PROJECT_ID="$(meta_value 'project_id')"
  fi
fi

echo "bd-doctor: repo=$REPO_ROOT"
echo "  port file: ${PORT_FILE_VAL:-<missing>}"
echo "  pid  file: ${PID_FILE_VAL:-<missing>}"
if [ "$EXTERNALLY_MANAGED" -eq 1 ]; then
  echo "  mode:      externally-managed (project_id=${PROJECT_ID:-?})"
else
  echo "  mode:      self-managed (no dolt_server_port in metadata.json)"
fi

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
# Rogue orphans: dolt sql-servers whose cwd is under THIS project's .beads data-dir
# but whose PID is NOT the supervised instance. They hold breaker-open state and risk
# data-dir double-open corruption, so they must be killed (adj-182).
ROGUE_PIDS=""

# Supervised PID seam: under externally-managed mode the launchd/systemd agent owns the
# one legitimate server; the doctor must know its PID so it can tell rogues apart. The
# pid file is the supervised instance's PID in this mode. Test seam:
# BD_DOCTOR_SUPERVISED_PID overrides it directly. When EMPTY (mode unknown / agent not
# loaded) the doctor refuses to guess and kills nothing — killing the wrong process is
# worse than a stale file.
SUPERVISED_PID="${BD_DOCTOR_SUPERVISED_PID:-}"
if [ -z "$SUPERVISED_PID" ] && [ "$EXTERNALLY_MANAGED" -eq 1 ]; then
  SUPERVISED_PID="$PID_FILE_VAL"
fi

# classify_dolt <pid> <port> <cwd>: given one discovered dolt, record it as the adjutant
# server (cwd under .beads) and flag it rogue if it is NOT the supervised PID.
classify_dolt() {
  local _pid="$1" _port="$2" _cwd="$3"
  echo "    pid=${_pid:-?} port=${_port:-?} cwd=${_cwd:-?}"
  if [ -n "$_cwd" ] && [[ "$_cwd" == "$BD_DIR"* ]]; then
    if [ -n "$SUPERVISED_PID" ] && [ "$_pid" != "$SUPERVISED_PID" ]; then
      # cwd under our data-dir but not the supervised instance → rogue orphan.
      ROGUE_PIDS="${ROGUE_PIDS:+$ROGUE_PIDS }$_pid"
    else
      ADJUTANT_DOLT_PID="$_pid"
      ADJUTANT_DOLT_PORT="$_port"
    fi
  fi
}

# Test seam: BD_DOCTOR_DOLT_OVERRIDE injects discovered dolt servers, bypassing the
# ps/lsof scan (external deps). Multiple servers are `;`-separated, each "<pid> <port>
# <cwd>". Unset in production.
if [ -n "${BD_DOCTOR_DOLT_OVERRIDE:-}" ]; then
  echo "  found dolt processes (override):"
  _ovr_rest="$BD_DOCTOR_DOLT_OVERRIDE"
  while [ -n "$_ovr_rest" ]; do
    case "$_ovr_rest" in
      *";"*) _ovr_entry="${_ovr_rest%%;*}"; _ovr_rest="${_ovr_rest#*;}" ;;
      *)     _ovr_entry="$_ovr_rest";       _ovr_rest="" ;;
    esac
    [ -z "$_ovr_entry" ] && continue
    read -r _ovr_pid _ovr_port _ovr_cwd <<< "$_ovr_entry"
    classify_dolt "$_ovr_pid" "$_ovr_port" "$_ovr_cwd"
  done
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
    classify_dolt "$pid" "$port" "$pwdir"
  done
fi

# ── Rogue kill (adj-182) ──────────────────────────────────────────────────────
# A rogue dolt on our data-dir double-opens the database and pins the circuit breaker
# open. Kill it BEFORE any diagnosis/repair so the supervised server (or restart) owns
# the data-dir cleanly. Test seam: BD_DOCTOR_KILL substitutes `kill` (tests use `echo`).
if [ -n "$ROGUE_PIDS" ]; then
  kill_cmd="${BD_DOCTOR_KILL:-kill}"
  for _rogue in $ROGUE_PIDS; do
    red "ROGUE dolt detected: pid=$_rogue has cwd under $BD_DIR but is not the supervised server (pid=${SUPERVISED_PID:-?})"
    yellow "  killing rogue orphan: $kill_cmd $_rogue"
    $kill_cmd "$_rogue" 2>/dev/null || red "  WARN: failed to kill rogue pid=$_rogue"
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

  if [ "$RESTART" -eq 1 ]; then
    # Auto-restart path (adj-zrr1c AC).
    #
    # Under externally-managed mode (adj-182) the launchd agent owns the one server, so
    # `bd dolt start` would CONFLICT — race the supervisor and risk two servers on one
    # data-dir. Instead we kickstart the launchd agent: `launchctl kickstart -k
    # gui/<uid>/com.adjutant.dolt.<projectId>` (-k = kill-then-restart the job).
    #
    # Test seams: BD_DOCTOR_RESTART_CMD (explicit override, highest precedence — used to
    # stub the whole command) and BD_DOCTOR_LAUNCHCTL (substitutes the `launchctl`
    # binary so tests capture the chosen kickstart command without executing it).
    if [ -n "${BD_DOCTOR_RESTART_CMD:-}" ]; then
      restart_cmd="$BD_DOCTOR_RESTART_CMD"
    elif [ "$EXTERNALLY_MANAGED" -eq 1 ]; then
      launchctl_bin="${BD_DOCTOR_LAUNCHCTL:-launchctl}"
      restart_cmd="$launchctl_bin kickstart -k gui/$(id -u)/com.adjutant.dolt.${PROJECT_ID}"
    else
      # Self-managed fallback. BD_DOCTOR_BD substitutes the `bd` binary so tests can
      # assert this branch is chosen without spawning a real dolt server.
      bd_bin="${BD_DOCTOR_BD:-bd}"
      restart_cmd="$bd_bin dolt start"
    fi
    yellow "--restart: attempting recovery via: $restart_cmd"
    if eval "$restart_cmd"; then
      if bd_ok; then
        green "Restart succeeded — bd CLI is healthy again."
        exit 0
      fi
      red "Restart ran but bd still fails. Re-run this script to diagnose further."
      exit 1
    fi
    red "Restart command failed: $restart_cmd"
    exit 1
  fi

  yellow "RECOVERY OPTIONS:"
  echo "  1) Restart full dev stack:   ./scripts/dev.sh"
  echo "  2) Or just bd dolt:          (from $REPO_ROOT) bd dolt start"
  echo "  3) Or re-run with --restart to do (2) automatically."
  echo "  4) After bd dolt is running, re-run this script to verify."
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
