#!/bin/bash
# Safe kill script for Adjutant dev servers
#
# CRITICAL: Do NOT use `lsof -ti:PORT | xargs kill -9` to kill dev servers!
# That command returns PIDs for ALL processes with connections to the port,
# including Claude Code agents with active MCP SSE connections. Killing those
# PIDs nukes every connected agent — not just the server.
#
# This script kills only the LISTENING processes (the actual servers),
# leaving connected clients (agents) unharmed. Agents will detect the
# disconnection and reconnect when the server restarts.
#
# See: adj-102 (agent kill cascade bug)

set -euo pipefail

PORTS=(4200 4201)
killed=0

for port in "${PORTS[@]}"; do
    # Find ONLY the process LISTENING on the port (the server), not connected clients
    # lsof -sTCP:LISTEN filters to listening sockets only
    pids=$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null || true)

    if [ -n "$pids" ]; then
        for pid in $pids; do
            echo "Killing server on port $port (PID $pid)"
            kill -9 "$pid" 2>/dev/null || true
            killed=$((killed + 1))
        done
    fi
done

if [ $killed -eq 0 ]; then
    echo "No servers found listening on ports ${PORTS[*]}"
fi
