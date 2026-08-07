#!/bin/bash
# tunnel.sh - Expose Adjutant UI via ngrok for remote access
#
# Usage:
#   ./scripts/tunnel.sh           # Start tunnel (checks if server is running)
#   ./scripts/tunnel.sh --no-wait # Start tunnel without checking (for concurrently)
#   ./scripts/tunnel.sh --help    # Show this help
#
# Prerequisites:
#   1. Install ngrok: brew install ngrok
#   2. Sign up at ngrok.com and get your authtoken
#   3. Configure: ngrok config add-authtoken <your-token>
#
# Environment variables (set in backend/.env):
#   NGROK_DOMAIN - Permanent domain (e.g., your-domain.ngrok.io)
#   NGROK_PORT   - Port to tunnel (default: 4200)
#   NGROK_AUTH   - Basic auth credentials (format: user:password)
#
# How it works:
#   - Tunnels the frontend (port 4200) which proxies /api to backend
#   - If NGROK_DOMAIN is set, uses permanent domain
#   - Otherwise, generates a random ngrok URL

set -e

# Load environment variables from backend/.env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../backend/.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/../backend/.env" | grep -v '^$' | xargs)
fi

PORT="${NGROK_PORT:-4200}"
NGROK_CMD="ngrok"
NO_WAIT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

show_help() {
    head -20 "$0" | tail -18 | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Parse arguments
for arg in "$@"; do
    case $arg in
        --help|-h)
            show_help
            ;;
        --no-wait)
            NO_WAIT=true
            ;;
    esac
done

# Check if ngrok is installed
if ! command -v $NGROK_CMD &> /dev/null; then
    echo -e "${RED}Error: ngrok is not installed${NC}"
    echo ""
    echo "Install ngrok:"
    echo "  brew install ngrok"
    echo ""
    echo "Then configure your authtoken:"
    echo "  ngrok config add-authtoken <your-token>"
    echo ""
    echo "Get your authtoken at: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

# Check if dev server is running (skip with --no-wait)
if [[ "$NO_WAIT" == "false" ]]; then
    if ! lsof -i:$PORT &> /dev/null; then
        echo -e "${YELLOW}Warning: Dev server doesn't appear to be running on port $PORT${NC}"
        echo ""
        echo "Start the dev server first:"
        echo "  npm run dev"
        echo ""
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    # Wait a moment for the dev server to start when running with concurrently
    echo -e "${YELLOW}Waiting for dev server to start...${NC}"
    sleep 3
fi

echo -e "${GREEN}Starting ngrok tunnel on port $PORT...${NC}"
echo ""

# Build ngrok command arguments
NGROK_ARGS=""

if [ -n "$NGROK_DOMAIN" ]; then
    # Strip https:// or http:// prefix and trailing slash if present
    CLEAN_DOMAIN=$(echo "$NGROK_DOMAIN" | sed 's|^https://||' | sed 's|^http://||' | sed 's|/$||')
    NGROK_ARGS="$NGROK_ARGS --url=https://$CLEAN_DOMAIN"
    echo "Using permanent domain: $CLEAN_DOMAIN"
else
    echo "No NGROK_DOMAIN set - using random URL"
    echo "Set NGROK_DOMAIN in backend/.env for a permanent URL"
fi

if [ -n "$NGROK_AUTH" ]; then
    NGROK_ARGS="$NGROK_ARGS --basic-auth=$NGROK_AUTH"
    echo "Password protection: enabled"
fi

echo ""
echo "---"
# Forward to 127.0.0.1:$PORT, NOT a bare "$PORT" (adj-9tqx4).
#
# Given a bare port, ngrok targets "localhost", resolves it to ::1 first, and
# reconnects aggressively. Every dev-server restart orphaned those IPv6
# connections, and they piled up in SYN_SENT (measured: 348 of them against
# [::1]:4200) until the listener's IPv6 SYN backlog was saturated. Once full,
# the kernel silently drops new SYNs on that path — so the BROWSER stalled to
# its 30s timeout on ~40% of requests to localhost:4200 while the identical
# request to 127.0.0.1:4200 answered in ~6ms and the dev server logged 200s.
#
# That is the whole "COMM ERROR: REQUEST TIMED OUT AFTER 30000MS" saga: not a
# Vite bind bug, not a backend bug — the tunnel was exhausting the IPv6 backlog.
# Pinning ngrok to IPv4 keeps it off that path entirely.
$NGROK_CMD http $NGROK_ARGS 127.0.0.1:$PORT
