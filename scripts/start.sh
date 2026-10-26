#!/bin/sh
# Production start: applies pending Prisma migrations, then replaces this shell with `next start`
# bound to 127.0.0.1 (exec, so a systemd unit's main PID is the single Node server process).
# The app never migrates itself; a failed migration stops here and the server does not start.
# Configuration (DATABASE_URL, login, BACKUP_DIR, ...) comes from the environment, e.g. a systemd
# EnvironmentFile. PORT defaults to 3000.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
PATH="$ROOT/node_modules/.bin:$PATH"
export PATH
NEXT_TELEMETRY_DISABLED=1
export NEXT_TELEMETRY_DISABLED

prisma migrate deploy
exec next start --hostname 127.0.0.1 --port "${PORT:-3000}"
