#!/bin/bash
# adjutant-ngrok.sh — launchd-supervised ngrok tunnel (cc.jmm.ngrok.io -> :4200).
#
# Keeps the public dashboard/iOS tunnel green across crashes. Mirrors the domain/
# auth resolution of scripts/tunnel.sh by sourcing backend/.env (NGROK_DOMAIN,
# NGROK_AUTH). launchd KeepAlive restarts ngrok if it exits.
#
# Source of truth: scripts/supervisor/adjutant-ngrok.sh in the repo; the installer
# copies it to ~/.adjutant/. ngrok lives at /usr/local/bin/ngrok (Homebrew, x86_64).
set -uo pipefail

APP_DIR="${ADJUTANT_APP_DIR:-/Users/Reason/code/ai/adjutant}"
PORT="${ADJUTANT_FRONTEND_PORT:-4200}"

# Source NGROK_* from backend/.env (same source scripts/tunnel.sh uses).
if [ -f "$APP_DIR/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/backend/.env"
  set +a
fi

DOMAIN="${NGROK_DOMAIN:-cc.jmm.ngrok.io}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

ARGS=(http --url="https://$DOMAIN")
if [ -n "${NGROK_AUTH:-}" ]; then
  ARGS+=(--basic-auth="$NGROK_AUTH")
fi
ARGS+=("$PORT")

echo "[$(date -u +%FT%TZ)] adjutant-ngrok tunneling https://$DOMAIN -> :$PORT"
exec ngrok "${ARGS[@]}"
