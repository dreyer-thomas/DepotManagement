#!/bin/sh
# Production deploy. Run it as the service user that owns the checkout, e.g.
#   sudo -u depot -H /home/depot/apps/DepotManagement/scripts/deploy.sh
# 1. While the service still runs: refuses a checkout with local changes and fast-forwards it to
#    origin/$DEPOT_BRANCH (skipped with DEPOT_NO_PULL=1, e.g. to redeploy a rolled-back commit).
# 2. Stops the service, copies the database to the backup directory, runs `npm ci`, removes `.next`
#    and builds. The migrations run when the service starts (scripts/start.sh).
# 3. Starts the service, waits for it to answer and checks that an anonymous request is redirected
#    to /login, i.e. the login gate is live. Otherwise the service is stopped again.
# Any failure exits non-zero and leaves the service stopped: a half-finished build could serve pages
# without the login gate, so it is never restarted automatically. The message names the previous
# commit and the database copy for a rollback.
# Needs passwordless sudo for `systemctl stop|start <service>` and `journalctl -u <service>` only
# (sudo -n fails fast instead of prompting); see README "Production deployment".
#
# Settings (environment, with defaults):
#   DEPOT_SERVICE=depotmanagement   DEPOT_BRANCH=main   DEPOT_URL=http://127.0.0.1:3000 (match PORT)
#   DEPOT_DATABASE=/var/lib/depotmanagement/depot.db    DEPOT_BACKUP_DIR=/var/lib/depotmanagement/backups
#   DEPOT_PREDEPLOY_KEEP=5   DEPOT_START_TIMEOUT=60 (seconds)
#   DEPOT_FIRST_DEPLOY=1 allows a missing database (first deploy only); otherwise it is an error, so a
#   wrong DEPOT_DATABASE can never silently skip the copy.
set -eu

main() {
  SERVICE=${DEPOT_SERVICE:-depotmanagement}
  BRANCH=${DEPOT_BRANCH:-main}
  APP_URL=${DEPOT_URL:-http://127.0.0.1:3000}
  DATABASE=${DEPOT_DATABASE:-/var/lib/depotmanagement/depot.db}
  BACKUP_DIR=${DEPOT_BACKUP_DIR:-/var/lib/depotmanagement/backups}
  KEEP=${DEPOT_PREDEPLOY_KEEP:-5}
  TIMEOUT=${DEPOT_START_TIMEOUT:-60}
  ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
  cd "$ROOT"
  STOPPED=0
  PREVIOUS=
  COPY=

  echo "==> Deploy $SERVICE from $ROOT"
  if [ -n "$(git status --porcelain)" ]; then
    git status --short >&2
    fail "the checkout has local changes; commit, stash or discard them first"
  fi
  PREVIOUS=$(git rev-parse HEAD)
  if [ "${DEPOT_NO_PULL:-}" = "1" ]; then
    echo "==> Keep the checked-out commit $PREVIOUS (DEPOT_NO_PULL=1)"
  else
    step "Fetch origin/$BRANCH" git fetch origin "$BRANCH"
    step "Fast-forward to origin/$BRANCH" git merge --ff-only "origin/$BRANCH"
  fi
  echo "==> Commit $(git rev-parse --short HEAD) (was $(git rev-parse --short "$PREVIOUS"))"
  check_database

  step "Stop service $SERVICE" sudo -n systemctl stop "$SERVICE"
  STOPPED=1
  backup_database
  step "Install dependencies (npm ci)" npm ci
  step "Remove previous build (.next)" rm -rf .next
  step "Build (npm run build)" npm run build
  step "Start service $SERVICE (runs pending migrations)" sudo -n systemctl start "$SERVICE"
  check_login_gate
  echo "==> Deployed $(git rev-parse --short HEAD); $SERVICE is running."
}

# Before the stop: the database must exist and be non-empty, unless DEPOT_FIRST_DEPLOY=1.
check_database() {
  if [ -e "$DATABASE" ]; then
    [ -s "$DATABASE" ] || fail "database $DATABASE is empty; refusing to deploy"
    [ -d "$BACKUP_DIR" ] || fail "backup directory $BACKUP_DIR not found; set DEPOT_BACKUP_DIR"
  elif [ "${DEPOT_FIRST_DEPLOY:-}" = "1" ]; then
    echo "==> No database yet (first deploy), nothing to copy"
  else
    fail "database $DATABASE not found; set DEPOT_DATABASE, or DEPOT_FIRST_DEPLOY=1 on the first deploy"
  fi
}

# Copies the database (and a leftover -wal file) while the service is stopped, then keeps only the
# newest $KEEP pre-deploy copies. The app's daily backups (depot-*.sqlite) are not touched.
backup_database() {
  [ -e "$DATABASE" ] || return 0
  COPY="$BACKUP_DIR/predeploy-$(date +%Y%m%d-%H%M%S).sqlite"
  step "Copy database to $COPY" cp "$DATABASE" "$COPY"
  if [ -s "$DATABASE-wal" ]; then
    step "Copy database WAL" cp "$DATABASE-wal" "$COPY-wal"
  fi
  # shellcheck disable=SC2012 # file names are our own predeploy-<timestamp>.sqlite
  ls -1t "$BACKUP_DIR"/predeploy-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
    rm -f -- "$old" "$old-wal"
  done
}

# Waits until the server answers, then requires an anonymous GET / to redirect to /login.
check_login_gate() {
  waited=0
  answer=000
  while [ "$waited" -lt "$TIMEOUT" ]; do
    systemctl is-active --quiet "$SERVICE" || fail "service $SERVICE did not stay up"
    answer=$(curl -s -o /dev/null --max-time 5 -w '%{http_code} %{redirect_url}' "$APP_URL/" || true)
    case $answer in 000*|"") ;; *) break ;; esac
    sleep 1
    waited=$((waited + 1))
  done
  case $answer in
    3[0-9][0-9]\ */login*) echo "==> Login gate live (anonymous GET / -> $answer)" ;;
    000*|"") fail "no answer from $APP_URL within ${TIMEOUT}s (check DEPOT_URL against PORT)" ;;
    *)
      sudo -n systemctl stop "$SERVICE" || true
      fail "LOGIN GATE NOT ACTIVE: anonymous GET / answered '$answer', expected a redirect to /login; service stopped"
      ;;
  esac
}

step() {
  label=$1
  shift
  echo "==> $label"
  "$@" || fail "step failed: $label"
}

fail() {
  echo "deploy: $1" >&2
  if [ "$STOPPED" = "1" ]; then
    echo "The service $SERVICE is stopped. Logs:" >&2
    sudo -n journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
    if [ -n "$PREVIOUS" ]; then
      echo "Rollback: git -C $ROOT reset --hard $PREVIOUS, then rerun with DEPOT_NO_PULL=1." >&2
    fi
    if [ -n "$COPY" ]; then
      echo "Database before this deploy: $COPY (a migration may have run since)." >&2
    fi
  fi
  exit 1
}

# The whole script is parsed before it runs (main is called on the last line, followed by exit), so
# the fast-forward may rewrite this file safely.
main "$@"; exit
