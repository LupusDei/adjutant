#!/usr/bin/env bash
# node-abi-preflight.sh — make a poisoned native binding self-heal (adj-juy35).
#
# WHY THIS EXISTS (2026-09-02 outage):
#   better-sqlite3's binding had been compiled for Node 22 (NODE_MODULE_VERSION
#   127) while the launchd job runs Node 20.19.6 (115). The backend threw
#   ERR_DLOPEN_FAILED at startup — BEFORE binding its port — so launchd's
#   KeepAlive restarted it forever. A crash-loop is the worst failure mode
#   available here: it looks like a service that is starting, not one that is
#   broken, and the only evidence was an opaque dlopen line deep in the log.
#
#   Two Node versions live on this box (the fleet's other project runs v22,
#   adjutant's job runs v20), so ANY npm install from a v22 shell poisons this
#   checkout. The engines pin in package.json makes that fail loudly at install
#   time; this script handles the case where the poisoning already happened.
#
# WHAT IT DOES: actually LOADS the module under the running node — the only
# check that cannot be fooled by metadata — and, if that fails, rebuilds once
# and re-checks. Exit 0 = safe to start. Exit 1 = do not start, with a message
# that names the module, the ABI the running node needs, and the fix.
#
# Deliberately NOT a version-string comparison: the binding's recorded ABI can
# be right while the file is missing, truncated, or built for another arch. A
# load either works or it does not.
#
# Environment:
#   ADJUTANT_ABI_MODULES  space-separated modules to verify (default better-sqlite3)
# Run from the package directory whose node_modules should be checked.
set -uo pipefail

MODULES="${ADJUTANT_ABI_MODULES:-better-sqlite3}"
ABI="$(node -p 'process.versions.modules' 2>/dev/null || echo unknown)"

log() { echo "[abi-preflight] $*"; }

# Load the module the way the server will. `require` via createRequire so this
# works regardless of the package's "type": "module".
loads() {
  node -e "const{createRequire}=require('node:module');createRequire(process.cwd()+'/')('$1')" >/dev/null 2>&1
}

status=0

for module in $MODULES; do
  if loads "$module"; then
    continue
  fi

  log "ABI mismatch: '$module' will not load under $(node -v 2>/dev/null || echo 'this node') (NODE_MODULE_VERSION $ABI)."
  log "rebuilding '$module' — this is the adj-juy35 self-heal, not a hang; startup will be slow once."

  if npm rebuild "$module" >/dev/null 2>&1 && loads "$module"; then
    log "rebuilt '$module' successfully — binding now loads under NODE_MODULE_VERSION $ABI."
    continue
  fi

  status=1
  {
    log "FATAL: '$module' still will not load after a rebuild."
    log "  running node : $(node -v 2>/dev/null || echo unknown) (NODE_MODULE_VERSION $ABI)"
    log "  working dir  : $PWD"
    log "  most likely  : node_modules was installed by a DIFFERENT node than the one"
    log "                 running this service. Both live on this box (v22 elsewhere,"
    log "                 v20 here), and an npm install from the wrong shell poisons this tree."
    log "  fix          : nvm use \$(cat .nvmrc) && npm rebuild $module"
    log "                 (or: rm -rf node_modules && npm install, under that node)"
    log "Refusing to start — a crash-loop would hide this behind launchd restarts."
  } >&2
done

exit $status
