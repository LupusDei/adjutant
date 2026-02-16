#!/bin/bash
# Start Adjutant dev servers + ngrok
#
# Usage:
#   ./scripts/dev.sh [--gt-root <path>]
#   npm run dev [-- --gt-root <path>]
#
# Options:
#   --gt-root <path>  Path to Gas Town directory (enables mode switching)
#
# Examples:
#   npm run dev                        # Standalone mode in CWD
#   npm run dev -- --gt-root ~/gt      # Standalone + Gas Town available

set -e

# Load environment variables from backend/.env if it exists
if [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi

# Colors
YELLOW='\033[1;33m'
GREEN='\033[1;32m'
BLUE='\033[1;34m'
NC='\033[0m'

# Project root is always CWD
export ADJUTANT_PROJECT_ROOT="$PWD"
echo -e "${GREEN}Project root: $ADJUTANT_PROJECT_ROOT${NC}"

# Parse --gt-root option
GT_ROOT=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --gt-root)
            GT_ROOT="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Set GT_TOWN_ROOT only if --gt-root was provided
if [ -n "$GT_ROOT" ]; then
    # Expand tilde if present
    GT_ROOT="${GT_ROOT/#\~/$HOME}"

    if [ ! -d "$GT_ROOT" ]; then
        echo "Error: Gas Town directory does not exist: $GT_ROOT"
        exit 1
    fi

    export GT_TOWN_ROOT="$GT_ROOT"
    if [ -f "$GT_ROOT/mayor/town.json" ]; then
        echo -e "${BLUE}Gas Town: $GT_ROOT${NC}"
    else
        echo -e "${BLUE}Gas Town: $GT_ROOT (no mayor/town.json)${NC}"
    fi
fi

# Auto-install dependencies if missing
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    (cd backend && npm install)
    (cd frontend && npm install)
    echo ""
fi

# Check if ngrok is installed
if command -v ngrok &> /dev/null; then
    echo -e "${GREEN}Starting Adjutant + ngrok tunnel${NC}"
    echo ""
    npx concurrently -n backend,frontend,ngrok -c blue,green,magenta \
        "cd backend && npm run dev" \
        "cd frontend && npm run dev" \
        "./scripts/tunnel.sh --no-wait"
else
    echo -e "${YELLOW}ngrok not installed - starting without remote access${NC}"
    echo "To enable remote access: brew install ngrok && ngrok config add-authtoken <token>"
    echo ""
    echo -e "${GREEN}Starting Adjutant${NC}"
    echo ""
    npx concurrently -n backend,frontend -c blue,green \
        "cd backend && npm run dev" \
        "cd frontend && npm run dev"
fi
