#!/usr/bin/env bash
# ============================================================================
# dolt-heal.sh — self-heal watchdog for supervised dolt servers.
#   Follow-up to the 2026-06-11 outage: the rollout pinned metadata+config but
#   left .beads/dolt-server.port stale (old random port) → bd dialed dead ports
#   → "Dolt server unreachable". launchd only restarts on process *death*, not
#   on port-drift or a hung-but-alive server. This watchdog closes both gaps.
#
# For every project carrying a `dolt_server_port` pin (externally-managed), it:
#   1. Reconciles .beads/dolt-server.port == pinned port (fixes drift).
#   2. Probes the server (MySQL handshake) on the pinned port; if dead/hung,
#      `launchctl kickstart -k` the project's supervisor.
#   3. WRITE-PATH probe (adj-iw0vy): a server can pass the handshake while EVERY
#      write hangs (bd server-mode auto-import write-deadlock / read-only / disk
#      full). The handshake alone is blind to that, so such a server never self-
#      heals. A reachable server is also write-probed; a CONFIRMED write-wedge
#      (fails twice) is kickstarted like a dead one.
#
# Idempotent + safe to run on a timer. Run via bash (NOT zsh) to avoid noclobber.
#
# Source of truth: scripts/supervisor/dolt-heal.sh (+ dolt-write-probe.py) in the
# repo. The live copies are installed to ~/.adjutant/ and invoked by the
# com.adjutant.dolt-heal LaunchAgent (StartInterval 120). Edit the repo copies and
# reinstall — do NOT hand-edit ~/.adjutant/dolt-heal.sh.
#
# Usage: dolt-heal.sh [search-root]   (default /Users/Reason/code)
# ============================================================================
set -uo pipefail
ROOT="${1:-/Users/Reason/code}"
UID_=$(id -u)
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# The write-path probe lives next to this script (repo scripts/supervisor/ OR the
# installed ~/.adjutant/). When absent, the write check is skipped (handshake-only)
# so heal never regresses if only the .sh was deployed.
WRITE_PROBE="$SELF_DIR/dolt-write-probe.py"
checked=0; fixed=0

probe() { # $1=port -> exit 0 if server answers with a handshake, else 1
  python3 - "$1" <<'PY'
import socket,sys
try:
    s=socket.create_connection(("127.0.0.1",int(sys.argv[1])),timeout=4); s.settimeout(4)
    d=s.recv(16); s.close(); sys.exit(0 if d else 1)
except Exception:
    sys.exit(1)
PY
}

# Resolve the Dolt data dir for a project root: the dir under .beads/ that holds a
# .dolt/ (server data). bd HEAD stores at embeddeddolt (adj-gkrt3), older at dolt.
resolve_datadir() { # $1=project-root -> echoes data dir or empty
  local root="$1" cand
  for cand in "$root/.beads/dolt" "$root/.beads/embeddeddolt"; do
    if [ -d "$cand/.dolt" ]; then echo "$cand"; return 0; fi
  done
  echo ""
}

kick() { # $1=project-id  $2=basename  $3=reason
  local pid="$1" name="$2" reason="$3"
  if [ -n "$pid" ]; then
    if launchctl kickstart -k "gui/$UID_/com.adjutant.dolt.$pid" 2>/dev/null; then
      echo "[heal] $name: kickstarted supervisor ($reason)"; fixed=$((fixed+1))
    else
      echo "[heal] $name: WARN $reason AND kickstart failed (label com.adjutant.dolt.$pid)"
    fi
  else
    echo "[heal] $name: WARN $reason, no project_id to kickstart"
  fi
}

while IFS= read -r meta; do
  d=$(dirname "$(dirname "$meta")")
  pin=$(grep -oE '"dolt_server_port"[[:space:]]*:[[:space:]]*[0-9]+' "$meta" 2>/dev/null | grep -oE '[0-9]+$')
  [ -n "$pin" ] || continue                       # only pinned/externally-managed projects
  pid=$(grep -oE '"project_id"[[:space:]]*:[[:space:]]*"[^"]+"' "$meta" 2>/dev/null | sed -E 's/.*"([^"]+)"$/\1/')
  checked=$((checked+1))
  pf="$d/.beads/dolt-server.port"
  name=$(basename "$d")

  # 0. dolt_mode:server — without it bd runs externally-managed but defaults to SLOW
  # embedded dolt access (~3s/call vs ~0.15s via the server). 2026-06-11 perf bug.
  if ! grep -q '"dolt_mode"[[:space:]]*:[[:space:]]*"server"' "$d/.beads/metadata.json" 2>/dev/null; then
    if python3 -c "import json; f='$d/.beads/metadata.json'; m=json.load(open(f)); m['dolt_mode']='server'; json.dump(m,open(f,'w'),indent=2)" 2>/dev/null; then
      echo "[heal] $name: set dolt_mode=server (was embedded -> slow)"; fixed=$((fixed+1))
    fi
  fi

  # 1. port-file drift — THE outage cause
  cur=$(cat "$pf" 2>/dev/null || echo "")
  if [ "$cur" != "$pin" ]; then
    printf '%s' "$pin" > "$pf" && { echo "[heal] $name: port-file '$cur' -> $pin"; fixed=$((fixed+1)); }
  fi

  # 2. server health on the pinned port — kickstart if dead/hung
  if ! probe "$pin"; then
    kick "$pid" "$name" "server on $pin unresponsive"
    continue                                       # dead server: no point write-probing it
  fi

  # 3. WRITE-PATH liveness (adj-iw0vy) — the handshake passed, but is it WRITABLE?
  # A write-wedged server hangs the scratch write; the probe's timeout detects it.
  # Confirm with one retry before kickstarting so a transient blip never bounces a
  # healthy server fleet-wide. exit 0=writable, 1=wedged, 2=cannot-probe(skip).
  if [ -f "$WRITE_PROBE" ]; then
    datadir=$(resolve_datadir "$d")
    if [ -n "$datadir" ]; then
      python3 "$WRITE_PROBE" "$datadir"; wrc=$?
      if [ "$wrc" -eq 1 ]; then
        sleep 3
        python3 "$WRITE_PROBE" "$datadir"; wrc=$?  # confirm before healing
      fi
      case "$wrc" in
        0) : ;;                                    # writable — healthy
        2) : ;;                                    # cannot probe (no dolt) — skip silently
        *) kick "$pid" "$name" "reachable on $pin but WRITE-WEDGED (adj-iw0vy)" ;;
      esac
    fi
  fi
done < <(find "$ROOT" -maxdepth 4 -path '*/.beads/metadata.json' 2>/dev/null)

echo "[heal] checked=$checked fixed=$fixed at $(date '+%Y-%m-%d %H:%M:%S')"
