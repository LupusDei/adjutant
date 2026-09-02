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

# Native-ABI preflight (adj-juy35). On 2026-09-02 better-sqlite3's binding had
# been compiled for Node 22 (NODE_MODULE_VERSION 127) while this job runs Node
# 20 (115). The server threw ERR_DLOPEN_FAILED BEFORE binding its port, so
# KeepAlive restarted it forever — a crash-loop that reads as "starting", not
# "broken". The preflight loads the binding first and rebuilds it once if it
# will not load; if it still will not, it refuses to start and says exactly why,
# which is strictly better than an invisible restart loop. ~0.4s when healthy.
ABI_PREFLIGHT="$APP_DIR/scripts/supervisor/node-abi-preflight.sh"
if [ -x "$ABI_PREFLIGHT" ]; then
  if ! "$ABI_PREFLIGHT"; then
    echo "[$(date -u +%FT%TZ)] adjutant-backend FATAL: native ABI preflight failed — not starting" >&2
    exit 1
  fi
else
  echo "[$(date -u +%FT%TZ)] adjutant-backend WARN: $ABI_PREFLIGHT missing — starting without the ABI preflight" >&2
fi

# WATCH mode (default) preserves live reload-on-merge to main: when main advances,
# tsx reloads and the new code is served without a manual restart. Agents edit
# ISOLATED git worktrees (Constitution Rule 7), so the canonical tree only changes
# on an intentional merge — avoiding the adj-8mmyd "every edit bounces all MCP
# sessions" hazard. Set ADJUTANT_NO_WATCH=1 for a stable, no-reload backend.
# exec the LOCAL tsx, never `npx tsx`: npx may resolve a different tsx (or fetch
# one) and would run the server under a binary this tree did not install — the
# same class of mismatch as the ABI bug above. The deployed wrapper already did
# this; the repo copy had drifted to `npx tsx` (adj-juy35 finding).
if [ "${ADJUTANT_NO_WATCH:-}" = "1" ] || [ "${ADJUTANT_NO_WATCH:-}" = "true" ]; then
  echo "[$(date -u +%FT%TZ)] adjutant-backend mode: STABLE (no-watch)"
  exec ./node_modules/.bin/tsx src/index.ts
else
  echo "[$(date -u +%FT%TZ)] adjutant-backend mode: WATCH (reload-on-merge)"
  exec ./node_modules/.bin/tsx watch src/index.ts
fi
