#!/bin/bash
# install-server-supervisors.sh — install + load the launchd supervisors for the
# Adjutant dev stack: backend (:4201), frontend Vite (:4200), the ngrok tunnel, and
# a 120s health watchdog (adj-yi6do).
#
# WHY: only Dolt was launchd-supervised before this. The backend (tsx watch) and
# frontend (vite) ran under a `concurrently` dev stack with NO crash/session
# recovery — when Vite or the terminal died the dashboard + ngrok tunnel went 502.
# These LaunchAgents make the servers self-healing (KeepAlive auto-restart) under a
# PINNED node (.nvmrc => v20.19.6, so native bins never ABI-mismatch).
#
# MODEL: launchd is now the CANONICAL runner for backend + frontend + ngrok on this
# host. The `concurrently` dev stack (scripts/dev.sh) is RETIRED for these services
# here — do not run `npm run dev` alongside the supervisors (double-bind; --strictPort
# makes Vite crash-loop). See scripts/supervisor/README.md.
#
# Files (reproducible/tracked here; the live copies live OUTSIDE the repo):
#   wrappers -> ~/.adjutant/adjutant-{backend,frontend,ngrok,server-heal}.sh
#   plists   -> ~/Library/LaunchAgents/com.adjutant.{backend,frontend,ngrok,server-heal}.plist
#   logs     -> /tmp/adjutant-{backend,frontend,ngrok,server-heal}.log
#
# Usage:
#   ./scripts/install-server-supervisors.sh                # install + load (cutover)
#   ./scripts/install-server-supervisors.sh --files-only   # write wrappers+plists, do NOT load
#   ./scripts/install-server-supervisors.sh --uninstall    # bootout + remove all 4 jobs
#
# SAFETY: idempotent (bootout -> bootstrap). On a full install it frees :4200/:4201
# by killing only the LISTENING server PIDs (adj-102 safe-kill semantics — connected
# MCP agents are left intact), then bootstraps the supervisors so they bind cleanly.
set -euo pipefail

APP_DIR="${ADJUTANT_APP_DIR:-/Users/Reason/code/ai/adjutant}"
FRONTEND_PORT="${ADJUTANT_FRONTEND_PORT:-4200}"
BACKEND_PORT="${ADJUTANT_BACKEND_PORT:-4201}"
NGROK_URL="${ADJUTANT_NGROK_URL:-https://cc.jmm.ngrok.io}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/supervisor"
ADJ_DIR="$HOME/.adjutant"
LA_DIR="$HOME/Library/LaunchAgents"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
UID_=$(id -u)
DOMAIN_NAME="com.adjutant"

MODE="install"
case "${1:-}" in
  --files-only) MODE="files" ;;
  --uninstall)  MODE="uninstall" ;;
  "")           MODE="install" ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac

WRAPPERS=(adjutant-backend.sh adjutant-frontend.sh adjutant-ngrok.sh adjutant-server-heal.sh)
LABELS=(backend frontend ngrok server-heal)

boot_out() { # $1=label
  launchctl bootout "gui/$UID_/$DOMAIN_NAME.$1" 2>/dev/null || true
}

if [ "$MODE" = "uninstall" ]; then
  for l in "${LABELS[@]}"; do
    echo "[install] bootout $DOMAIN_NAME.$l"
    boot_out "$l"
    rm -f "$LA_DIR/$DOMAIN_NAME.$l.plist"
  done
  echo "[install] uninstalled. (wrappers in $ADJ_DIR left in place)"
  exit 0
fi

mkdir -p "$ADJ_DIR" "$LA_DIR"

# 1. Install wrapper scripts (repo -> ~/.adjutant)
for w in "${WRAPPERS[@]}"; do
  install -m 0755 "$SRC/$w" "$ADJ_DIR/$w"
  echo "[install] wrapper -> $ADJ_DIR/$w"
done

# 2. Render plists
PATH_ENV="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

write_server_plist() { # $1=label $2=wrapper $3=extra-env-key $4=extra-env-val
  local label="$DOMAIN_NAME.$1" wrapper="$2" ekey="${3:-}" eval_="${4:-}"
  local plist="$LA_DIR/$label.plist"
  {
    cat <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ADJ_DIR/$wrapper</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_ENV</string>
    <key>ADJUTANT_APP_DIR</key><string>$APP_DIR</string>
    <key>NVM_DIR</key><string>$NVM_DIR</string>
    <key>ADJUTANT_FRONTEND_PORT</key><string>$FRONTEND_PORT</string>
    <key>ADJUTANT_NGROK_URL</key><string>$NGROK_URL</string>
XML
    if [ -n "$ekey" ]; then printf '    <key>%s</key><string>%s</string>\n' "$ekey" "$eval_"; fi
    cat <<XML
  </dict>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>/tmp/$label.log</string>
  <key>StandardErrorPath</key><string>/tmp/$label.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
XML
  } > "$plist"
  echo "[install] plist  -> $plist"
}

write_heal_plist() {
  local label="$DOMAIN_NAME.server-heal"
  local plist="$LA_DIR/$label.plist"
  cat > "$plist" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ADJ_DIR/adjutant-server-heal.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_ENV</string>
    <key>ADJUTANT_NGROK_URL</key><string>$NGROK_URL</string>
  </dict>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/$label.log</string>
  <key>StandardErrorPath</key><string>/tmp/$label.log</string>
</dict>
</plist>
XML
  echo "[install] plist  -> $plist"
}

write_server_plist backend  adjutant-backend.sh
write_server_plist frontend adjutant-frontend.sh
write_server_plist ngrok    adjutant-ngrok.sh
write_heal_plist

if [ "$MODE" = "files" ]; then
  echo "[install] --files-only: wrappers + plists written, NOT loaded."
  exit 0
fi

# 3. Retire the legacy `concurrently` dev stack (scripts/dev.sh) so its
# dev-backend.sh `while true` retry loop cannot respawn a backend and race
# launchd for :4201. Patterns are adjutant-specific (script paths / tunnel
# domain) so other projects' `concurrently`/ngrok are never matched. Kill whole
# process groups (-P walk) so supervisor loops + their children all stop.
retire_legacy_dev_stack() {
  local patterns=(
    'concurrently -n backend,frontend,ngrok'
    'scripts/dev-backend.sh'
    'scripts/dev.sh'
    'scripts/tunnel.sh'
    "${NGROK_URL#https://}"   # the cc.jmm.ngrok.io tunnel (old ngrok must die so the new one binds)
  )
  local roots="" pat pids
  for pat in "${patterns[@]}"; do
    pids=$(pgrep -f "$pat" 2>/dev/null || true)
    roots="$roots $pids"
  done
  # De-dupe, then kill each tree deepest-first (children before parents).
  roots=$(echo "$roots" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ' || true)
  [ -z "$(echo "$roots" | xargs)" ] && { echo "[install] no legacy dev stack running"; return; }
  local all="" gen="$roots"
  while [ -n "$(echo "$gen" | xargs)" ]; do
    all="$all $gen"; local next="" p
    for p in $gen; do next="$next $(pgrep -P "$p" 2>/dev/null | tr '\n' ' ')"; done
    gen="$next"
  done
  # Reverse order (deepest PIDs were appended last) → TERM
  for p in $(echo "$all" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -rn -u); do
    echo "[install] retiring legacy dev-stack PID $p"
    kill "$p" 2>/dev/null || true
  done
  sleep 2
}
retire_legacy_dev_stack

# Free any port still held by a stray listener (adj-102: LISTENERS ONLY — never
# kill connected MCP agents).
free_port() { # $1=port
  local pids
  pids=$(lsof -ti:"$1" -sTCP:LISTEN 2>/dev/null || true)
  for pid in $pids; do
    echo "[install] freeing :$1 (killing listener PID $pid)"
    kill "$pid" 2>/dev/null || true
  done
}
free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

# 4. (Re)load each job: bootout -> bootstrap -> enable.
load_job() { # $1=label
  local label="$DOMAIN_NAME.$1"
  boot_out "$1"
  launchctl bootstrap "gui/$UID_" "$LA_DIR/$label.plist"
  launchctl enable "gui/$UID_/$label" 2>/dev/null || true
  echo "[install] loaded $label"
}
load_job backend
load_job frontend
load_job ngrok
load_job server-heal

echo ""
echo "[install] done. Supervisors loaded. Verify:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:$BACKEND_PORT/health"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:$FRONTEND_PORT"
echo "  launchctl list | grep $DOMAIN_NAME"
echo "  tail -f /tmp/$DOMAIN_NAME.backend.log"
