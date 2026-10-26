#!/bin/sh
# Production deploy: stops the systemd service, installs dependencies, builds and starts the service
# again. The service's start script (scripts/start.sh) applies pending migrations before the server
# starts. Run it as the user that owns the checkout; it needs sudo rights for
# `systemctl stop|start <service>` only, without a password prompt (sudo -n fails fast otherwise). Service name: DEPOT_SERVICE (default `depotmanagement`).
# Any failing step stops the deploy with a non-zero exit and leaves the service stopped.
set -eu

SERVICE=${DEPOT_SERVICE:-depotmanagement}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

step() {
  label=$1
  shift
  echo "==> $label"
  if ! "$@"; then
    echo "deploy: step failed: $label; the service $SERVICE is stopped." >&2
    echo "Logs: journalctl -u $SERVICE" >&2
    exit 1
  fi
}

step "Stop service $SERVICE" sudo -n systemctl stop "$SERVICE"
step "Install dependencies (npm ci)" npm ci
step "Build (npm run build)" npm run build
step "Start service $SERVICE" sudo -n systemctl start "$SERVICE"
echo "Service $SERVICE started; migrations run on start. Check: systemctl status $SERVICE and journalctl -u $SERVICE"
