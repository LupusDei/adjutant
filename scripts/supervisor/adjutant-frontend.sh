#!/bin/bash
# adjutant-frontend.sh — launchd-supervised Adjutant frontend (Vite, :4200).
#
# Runs Vite under the PINNED node (.nvmrc => v20.19.6). Vite's native deps
# (esbuild + @rollup/rollup-darwin-x64) are node-ABI-specific; running under a
# different nvm node than the one the bins were installed for crashes Vite on
# startup (the recurring outage adj-yi6do targets). Pinning node here makes the
# running node deterministic. launchd KeepAlive owns restart-on-crash.
#
# Source of truth: scripts/supervisor/adjutant-frontend.sh in the repo; the
# installer copies it to ~/.adjutant/. Edit the repo copy, then re-run the installer.
set -uo pipefail
export TZ=UTC

APP_DIR="${ADJUTANT_APP_DIR:-/Users/Reason/code/ai/adjutant}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
PORT="${ADJUTANT_FRONTEND_PORT:-4200}"

# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$APP_DIR/frontend" || { echo "[adjutant-frontend] FATAL: $APP_DIR/frontend missing" >&2; exit 1; }

nvm use >/dev/null 2>&1 || true   # reads frontend/.nvmrc => v20.19.6
echo "[$(date -u +%FT%TZ)] adjutant-frontend starting under node $(node -v) on :$PORT"

# --strictPort: fail fast (rather than silently picking 4201) if 4200 is taken, so
#   KeepAlive surfaces the conflict in the log instead of binding the wrong port.
# --host: bind 0.0.0.0 so the ngrok tunnel (and LAN) can reach it.
exec npx vite --port "$PORT" --strictPort --host
