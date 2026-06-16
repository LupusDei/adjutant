#!/bin/bash
# Backend dev server wrapper with crash recovery and logging
#
# - Runs tsx watch with stdout/stderr captured to a log file
# - Auto-restarts on crash (up to MAX_RETRIES times)
# - Resets retry counter after STABLE_THRESHOLD seconds of uptime
# - Rotates log file when it exceeds MAX_LOG_SIZE bytes
#
# Used by dev.sh — not intended to be run directly.

LOGS_DIR="backend/logs"
LOG_FILE="$LOGS_DIR/server.log"
MAX_RETRIES=50
RETRY_DELAY=3
STABLE_THRESHOLD=10
MAX_LOG_SIZE=5242880  # 5MB

retry_count=0

mkdir -p "$LOGS_DIR"

# Rotate log if too large
if [ -f "$LOG_FILE" ]; then
    log_size=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$log_size" -gt "$MAX_LOG_SIZE" ]; then
        mv "$LOG_FILE" "$LOG_FILE.1"
    fi
fi

while true; do
    start_time=$(date +%s)
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backend (attempt $((retry_count + 1)))..." | tee -a "$LOG_FILE"

    # Run the backend, tee output to both terminal and log file.
    #
    # adj-8mmyd: `tsx watch` hot-reloads on ANY change to index.ts's import graph
    # (the reachable src/*.ts files). In a multi-agent session, an agent saving a
    # watched backend source file in the CANONICAL checkout restarts the server and
    # bounces EVERY MCP session simultaneously (all agents drop to idle). Set
    # ADJUTANT_NO_WATCH=1 to run a STABLE backend (no file watching → no reload on
    # edit) while a squad is active. Durable root fix: agents edit isolated git
    # worktrees so their saves never touch the watched canonical tree (Constitution
    # Rule 7); then watch mode is safe for human devs.
    if [ "${ADJUTANT_NO_WATCH:-}" = "1" ] || [ "${ADJUTANT_NO_WATCH:-}" = "true" ]; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backend mode: STABLE (no-watch — ADJUTANT_NO_WATCH set; edits will NOT reload)" | tee -a "$LOG_FILE"
        ( cd backend && npx tsx src/index.ts ) 2>&1 | tee -a "$LOG_FILE"
    else
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backend mode: WATCH (hot-reload; set ADJUTANT_NO_WATCH=1 for a stable backend during multi-agent work)" | tee -a "$LOG_FILE"
        ( cd backend && npx tsx watch src/index.ts ) 2>&1 | tee -a "$LOG_FILE"
    fi
    exit_code=${PIPESTATUS[0]}

    end_time=$(date +%s)
    uptime=$((end_time - start_time))

    # Clean exit — stop restarting
    if [ $exit_code -eq 0 ]; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backend exited cleanly." | tee -a "$LOG_FILE"
        break
    fi

    # If it ran long enough, reset retry counter (it was stable before crashing)
    if [ $uptime -ge $STABLE_THRESHOLD ]; then
        retry_count=0
    fi

    retry_count=$((retry_count + 1))
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backend crashed (exit $exit_code, uptime ${uptime}s). Restart $retry_count/$MAX_RETRIES in ${RETRY_DELAY}s..." | tee -a "$LOG_FILE"

    if [ $retry_count -ge $MAX_RETRIES ]; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Max retries ($MAX_RETRIES) reached. Backend will not restart." | tee -a "$LOG_FILE"
        # Exit with error so concurrently knows this process died permanently
        exit 1
    fi

    sleep $RETRY_DELAY
done
