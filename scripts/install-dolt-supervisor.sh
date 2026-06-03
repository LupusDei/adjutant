#!/bin/bash
# install-dolt-supervisor.sh — install + load the supervised Dolt LaunchAgent for
# a project (adj-182.1.4, T004c).
#
# THIN ENTRYPOINT: this script holds NO orchestration logic. It delegates entirely
# to the TS adapter `cli/lib/install-dolt-supervisor-cli.ts`, which resolves the
# real seams (allocate+pin port, render+write plist, launchctl bootout→bootstrap,
# SQL-probe verify) and calls `installSupervisor()` (cli/lib/dolt-supervisor.ts).
#
# Usage:
#   ./scripts/install-dolt-supervisor.sh            # install for the current repo
#   ./scripts/install-dolt-supervisor.sh <repoRoot> # install for an explicit repo
#
# SAFETY: idempotent (bootout→bootstrap). Never deletes .dolt/**/LOCK. Aborts
# (exit 1) if the supervised server fails its SQL probe.

set -euo pipefail

REPO_ROOT="${1:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/../cli" && pwd)"

exec npx --prefix "$CLI_DIR/.." tsx \
  "$CLI_DIR/lib/install-dolt-supervisor-cli.ts" "$REPO_ROOT"
