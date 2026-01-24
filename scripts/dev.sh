#!/bin/bash
# Start Adjutant dev servers + ngrok with optional GT directory
#
# Usage:
#   ./scripts/dev.sh [GT_DIR]
#   npm run dev [-- GT_DIR]
#
# Arguments:
#   GT_DIR  Path to gastown town directory (default: ~/gt)
#
# Examples:
#   npm run dev                    # Uses ~/gt + ngrok (if installed)
#   npm run dev -- /path/to/town   # Uses custom path + ngrok
#   npm run dev -- ~/my-gastown    # Uses ~/my-gastown + ngrok

set -e

# Load environment variables from backend/.env if it exists
if [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi

# Colors
YELLOW='\033[1;33m'
NC='\033[0m'

# Get GT directory from GT_TOWN_ROOT env var, argument, or default to ~/gt
if [ -n "$GT_TOWN_ROOT" ]; then
    GT_DIR="$GT_TOWN_ROOT"
    echo "Using GT directory from GT_TOWN_ROOT: $GT_DIR"
else
    GT_DIR="${1:-$HOME/gt}"
    echo "Using GT directory from argument: $GT_DIR"
fi

    # Expand tilde if present
    GT_DIR="${GT_DIR/#\~/$HOME}"

# Validate directory exists
if [ ! -d "$GT_DIR" ]; then
    echo "Error: GT directory does not exist: $GT_DIR"
    echo "Usage: npm run dev [-- /path/to/gt]"
    exit 1
fi

# Check for town.json marker
if [ ! -f "$GT_DIR/mayor/town.json" ]; then
    echo "Warning: $GT_DIR does not appear to be a gastown town (missing mayor/town.json)"
    echo "Continuing anyway..."
fi

# Export GT_TOWN_ROOT
export GT_TOWN_ROOT="$GT_DIR"

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
    echo "Starting Adjutant with GT_TOWN_ROOT=$GT_DIR + ngrok tunnel"
    echo ""
    npx concurrently -n backend,frontend,ngrok -c blue,green,magenta \
        "cd backend && npm run dev" \
        "cd frontend && npm run dev" \
        "./scripts/tunnel.sh --no-wait"
else
    echo -e "${YELLOW}ngrok not installed - starting without remote access${NC}"
    echo "To enable remote access: brew install ngrok && ngrok config add-authtoken <token>"
    echo ""
    echo "Starting Adjutant with GT_TOWN_ROOT=$GT_DIR"
    echo ""
    npx concurrently -n backend,frontend -c blue,green \
        "cd backend && npm run dev" \
        "cd frontend && npm run dev"
fi
