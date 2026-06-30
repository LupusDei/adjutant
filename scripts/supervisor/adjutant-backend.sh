#!/bin/bash
# adjutant-backend.sh — launchd-supervised Adjutant backend API (:4201).
#
# Runs the backend under the PINNED node (.nvmrc => v20.19.6) so Vite/tsx native
# bins always match the running node ABI (adj-yi6do). launchd KeepAlive owns
# restart-on-crash; this wrapper only pins node and execs the server.
#
# Source of truth: scripts/supervisor/adjutant-backend.sh in the repo. The installer
# (scripts/install-server-supervisors.sh) copies this to ~/.adjutant/ and the
# com.adjutant.backend LaunchAgent invokes it. Edit the repo copy, then re-run the
# installer — do NOT hand-edit ~/.adjutant/adjutant-backend.sh.
set -uo pipefail
export TZ=UTC

APP_DIR="${ADJUTANT_APP_DIR:-/Users/Reason/code/ai/adjutant}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$APP_DIR/backend" || { echo "[adjutant-backend] FATAL: $APP_DIR/backend missing" >&2; exit 1; }

nvm use >/dev/null 2>&1 || true   # reads backend/.nvmrc => v20.19.6
echo "[$(date -u +%FT%TZ)] adjutant-backend starting under node $(node -v)"

# WATCH mode (default) preserves live reload-on-merge to main: when main advances,
# tsx reloads and the new code is served without a manual restart. Agents edit
# ISOLATED git worktrees (Constitution Rule 7), so the canonical tree only changes
# on an intentional merge — avoiding the adj-8mmyd "every edit bounces all MCP
# sessions" hazard. Set ADJUTANT_NO_WATCH=1 for a stable, no-reload backend.
if [ "${ADJUTANT_NO_WATCH:-}" = "1" ] || [ "${ADJUTANT_NO_WATCH:-}" = "true" ]; then
  echo "[$(date -u +%FT%TZ)] adjutant-backend mode: STABLE (no-watch)"
  exec npx tsx src/index.ts
else
  echo "[$(date -u +%FT%TZ)] adjutant-backend mode: WATCH (reload-on-merge)"
  exec npx tsx watch src/index.ts
fi
