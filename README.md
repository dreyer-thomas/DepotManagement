# DepotManagement

A self-hosted portfolio tracker for private investors with several securities accounts (Depots). It is a personal replacement for commercial trackers such as Parqet, so your financial data stays on your own machine or server.

> **Status:** v1 feature-complete; runs locally or on a Linux server behind Nginx (see "Production deployment").

## Planned features (v1)

- Combined overview of all Depots, plus a view of each Depot on its own
- Value development over time
- Gain/loss evaluation:
  - FIFO cost basis
  - Realized and unrealized gains
  - TTWROR and IRR side by side
- Portfolio composition by position, asset type and Depot
- News on held securities
- Cash account (Verrechnungskonto) per Depot
- Transaction entry by hand or by importing broker PDF documents
- One-time migration from a Parqet CSV export
- Export and backup

Requirements are documented in the [PRD](_bmad-output/planning-artifacts/prds/prd-DepotManagement-2026-10-25/prd.md).

## Installation

### Prerequisites

- Node.js 24 LTS (`>=24.11 <25`; see `.nvmrc`) and npm 11

### Setup

```sh
npm install              # or `npm ci`; runs `prisma generate` afterwards
cp .env.example .env     # set at least the three login variables (see "Login")
npx prisma migrate deploy
npm run dev              # http://localhost:3000
```

The database is a SQLite file. If `DATABASE_URL` is empty, it defaults to `~/.depotmanagement/depot.db` in your home directory, outside the source tree. Its directory is created automatically. When you set `DATABASE_URL`, use an absolute path such as `file:/home/<user>/.depotmanagement/depot.db`, never `~`: the tilde is not expanded, so the path would point into the repository.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | `scripts/start.sh`: `prisma migrate deploy`, then the production server (`next start`) on `127.0.0.1`, port `PORT` (default 3000). The app never migrates itself. |
| `npm test` | Vitest unit and architecture tests |
| `npm run lint` | ESLint (`eslint-config-next`, core-web-vitals and TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:tracked` | Fails if git tracks `.env` files, SQLite files, CSVs or PDFs (see "Privacy"); also run by `npm test` |
| `npm run hash-password` | Prints an `AUTH_PASSWORD_HASH=` line for `.env` (see "Login") |

The `dev`, `build` and `start` scripts set `NEXT_TELEMETRY_DISABLED=1`, so Next.js telemetry is off. The app embeds no analytics.

### Source tree

```text
src/
  app/        # Next.js routes and pages (thin); _components/ holds the app shell
  core/       # pure functions (decimal.js only; enforced by test/architecture)
  modules/    # services per domain module (auth, ledger, prices, logos, news, import, migration, backup)
  db/         # Prisma client singleton (WAL, busy timeout) and database URL resolution
  theme/      # "Minze" MUI theme and design tokens
prisma/       # schema.prisma and migrations/
test/
  architecture/  # dependency guards
  fixtures/      # synthetic, anonymised fixtures only (*.csv.txt / *.txt)
```

## Configuration

All configuration comes from environment variables or an untracked `.env`. [.env.example](.env.example) lists every name without values: `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `BACKUP_DIR`, `BACKUP_KEEP`, `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`, `DATA_DIR`, `DEV_ALLOWED_ORIGINS`.

To open `npm run dev` from a phone or tablet in your network, set `DEV_ALLOWED_ORIGINS` to the host names or a wildcard such as `192.168.178.*` and restart the dev server; otherwise Next.js blocks its scripts for other devices and pages load without charts or working controls. `npm start` does not need it.

## Login

The app has a single user. Every page and route needs a login: pages redirect to `/login` and return to the original URL afterwards; route handlers under `/api/` answer `401`.

Set three variables in `.env`:

| Variable | Rule |
| --- | --- |
| `AUTH_USERNAME` | The login name; not empty. |
| `AUTH_PASSWORD_HASH` | bcrypt hash of the password (`$2a$`/`$2b$`/`$2y$`, cost 04–31, 53 characters). |
| `SESSION_SECRET` | Signs the session cookie; at least 32 characters, e.g. from `openssl rand -base64 48`. |

Create the hash with the script. It asks for the password twice without echoing it, or reads it from stdin, never from the command line:

```sh
npm run -s hash-password                      # interactive prompt
printf '%s\n' "$PASSWORD" | npm run -s hash-password
```

It prints a line like `AUTH_PASSWORD_HASH=\$2b\$12\$...`. Paste it into `.env` as printed: Next.js expands `$name` in `.env` values, even in quotes, so every `$` of the hash must be written as `\$`. If you set the variable in a real environment instead (systemd, Docker), use the plain hash without backslashes.

If a variable is missing, empty or invalid, `npm run dev` and `npm start` print which variables are wrong (never their values) and exit with an error before serving any request. `npm run build` needs none of them.

After login the session lasts 7 days and is not extended; then you log in again. The session cookie is `HttpOnly` and `SameSite=Lax`. It is marked `Secure` when the request came in over HTTPS, as reported by a TLS-terminating reverse proxy in `X-Forwarded-Proto`. "Abmelden" in the top bar ends the session. Changing `SESSION_SECRET` or `AUTH_USERNAME` logs out every open session. Changing the password (`AUTH_PASSWORD_HASH`) does not end existing sessions; rotate `SESSION_SECRET` too to log out everywhere.

### Home-screen app

The app can be added to a phone's home screen and then opens full-screen, without browser bars, in the app's colours (status bar follows the phone's light or dark mode). Use "Zum Home-Bildschirm" in iOS Safari or "App installieren" in Android Chrome. This needs the HTTPS deployment. Only the login page, `/manifest.webmanifest` and the four files under `/icons/` are reachable without a login. On iOS the installed app keeps its own cookies apart from Safari, so log in once inside the app. There is no offline mode and no service worker: all data stays on the server and the app needs a connection.

The icons in `public/icons/` are generated from an inline SVG in the primary colour of `src/theme/tokens.ts`; after changing that colour run `node scripts/generate-icons.mjs` and commit the PNGs.

## Data export

Settings → "Datensicherung" → "Exportieren" downloads all data as one JSON file (`GET /api/export`, login required). The file is named `depotmanagement-export-<YYYYMMDD-HHMMSS>.json` (Europe/Berlin time of the download) and is pretty-printed with two spaces. It carries no timestamp inside, so the same data always yields the same file.

Format rules:

- Decimals (amounts, quantities, prices, ratios) are strings exactly as stored, e.g. `"1.50000"`; never JSON numbers.
- Business dates are `YYYY-MM-DD` strings; timestamps (`createdAt`, `fetchedAt`, ...) are UTC ISO strings as stored.
- IDs and the intra-day `sequence` are kept. Absent values are `null`.
- Only stored data: Positions, balances, Cost Basis and returns are computed after a restore, never exported.
- Arrays are sorted by stable keys (see below).

Top-level keys, in this order (the zod schema in [src/modules/backup/schema.ts](src/modules/backup/schema.ts) is the binding contract):

| Key | Records | Sorted by |
| --- | --- | --- |
| `schemaVersion` | The current format version (`EXPORT_SCHEMA_VERSION` in [src/modules/backup/schema.ts](src/modules/backup/schema.ts)) | — |
| `depots` | `id`, `name`, `broker` (`COMDIRECT`/`DEUTSCHE_BANK`/`FINANZEN_ZERO`), `archived` | `id` |
| `securities` | `id`, `isin`, `cryptoSymbol`, `name`, `assetType` | `id` |
| `providerMappings` | `id`, `securityId`, `provider` (`YAHOO`/`ONVISTA`/`COINGECKO`), `symbol`, `origin` (`AUTO`/`MANUAL`), `updatedAt`, `historyFrom`, `fetchedAt`, `fetchError`; provider and symbol `null` = "not found" marker | `securityId` |
| `transactions` | `id`, `depotId`, `securityId`, `type` (`BUY`, `SELL`, `DIVIDEND`, `FEE`, `TAX`, `DEPOSIT`, `WITHDRAWAL`, `ADJUSTMENT`), `date`, `sequence`, `quantity`, `price`, `amount`, `fee`, `tax`, `note` | `depotId`, `date`, `sequence` |
| `corporateActions` | `id`, `securityId`, `newSecurityId`, `type` (`SPLIT`/`ISIN_CHANGE`), `date`, `ratioOld`, `ratioNew` | `securityId`, `type`, `date` |
| `reconciliationRuns` | `id`, `depotId`, `statementDate`, `status` (`OPEN`/`FINISHED`), `createdAt`, `finishedAt`, `rows`: [`id`, `runId`, `securityId` (`null` = Cash Account), `statementValue`, `checked`] | `id`; rows by `id` |
| `prices` | `id`, `securityId`, `date`, `source` (`MANUAL`/`PROVIDER`), `price`, `fetchedAt` | `securityId`, `date`, `source` |
| `logos` | Manually uploaded logos only: `id`, `securityId`, `contentType` (`image/png`/`image/jpeg`/`image/webp`), `fetchedAt`, `data` (file bytes as base64) | `securityId` |
| `watchlists` (last key) | `id`, `name`, `position`, `createdAt`, `entries`: [`id`, `securityId`, `note`, `dateAdded`, `position`, `source` (`APP`/`MCP`), `clientName`, `createdAt`] | `position`; entries by `position`, `id` |

Not exported: caches and anything that can be fetched again or is temporary: fetched logos and their "nothing found" markers, news headlines, PDF import staging (batches, items, stored PDFs). OAuth data of connected apps (clients, grants, tokens) is never exported. A manual logo whose file is missing, empty or otherwise unusable on disk is skipped with a warning in the log.

`schemaVersion` changes only when the format changes incompatibly. Restore reads older versions by upgrading them step by step to the current one.

### Restore

Settings → "Datensicherung" → "Wiederherstellen" replaces **all** data with the content of an export file. Choose the file and type `WIEDERHERSTELLEN` to enable the button. Restore never merges: afterwards the database holds exactly the rows of the file.

- Replaced: Depots, Securities, Transactions, corporate actions, reconciliation runs, provider mappings, Prices, manual logos and watchlists with their entries (a file older than version 6 has none, so the instance afterwards has no watchlists), with their IDs, sequences, decimals and dates exactly as in the file.
- Cleared: PDF import staging (batches and their stored PDFs), news headlines and fetched logos. They are fetched or uploaded again as needed.
- Connected apps (e.g. Claude) must be connected again after a restore; their OAuth data is not part of the export.
- Before anything is replaced, an automatic export of the current data is written to `BACKUP_DIR` (empty = `~/.depotmanagement/backups`; the directory is created if missing) as `depotmanagement-export-<YYYYMMDD-HHMMSS>.json`. The success message names this file. To undo a restore, restore that file.
- The file is checked completely before anything is written: at most 50 MB, valid JSON, a supported `schemaVersion` (older versions are upgraded step by step, newer ones are rejected), the schema above, consistent references and unique keys, and valid logo images. A rejected file shows the reason (and, for schema or consistency errors, the field path) and leaves every row and file unchanged.
- The replacement runs in one database transaction; if it fails, the old data stays as it was.

To move data from a local instance to production, export locally and restore on production; see [Moving local data to production](#moving-local-data-to-production).

## Daily database backup

The app copies its SQLite database once a day to `BACKUP_DIR` (empty = `~/.depotmanagement/backups`; created if missing) as `depot-<YYYY-MM-DD>.sqlite` (Europe/Berlin date). The copy runs at start-up when today's file is missing and then on the first hourly check of every new day. It uses SQLite's online backup API on a separate connection, so it is consistent even while the app writes (WAL mode); the file is written under a temporary name, made accessible to its owner only (`0600`) and renamed when complete.

After each successful backup only the newest `BACKUP_KEEP` files named `depot-<YYYY-MM-DD>.sqlite` are kept (empty or invalid = 30); other files in the directory, such as the automatic pre-restore exports, are never deleted. Settings → "Datensicherung" shows the time of the last successful backup; if the last attempt failed, it shows a warning instead, and the log names the error.

The default `BACKUP_DIR` is on the same disk as the database and does not protect against a disk failure: point `BACKUP_DIR` at another disk or a synced or off-site location.

### Restoring from a backup file

1. Stop the app.
2. Keep a copy of the current database file named by `DATABASE_URL` (empty = `~/.depotmanagement/depot.db`) and of its `-wal` and `-shm` files, if they exist.
3. Copy the chosen `depot-<YYYY-MM-DD>.sqlite` over the database file. The copy must stay readable and writable by the user the app runs as (the backup file is `0600`, owned by that user).
4. Delete the database file's `-wal` and `-shm` files next to it (e.g. `depot.db-wal`, `depot.db-shm`) if they exist; they belong to the replaced database.
5. Run `npx prisma migrate deploy` with the same `DATABASE_URL`: an older backup may lack newer migrations. With `npm start` or the production service this happens on start anyway (`scripts/start.sh`).
6. Start the app.

Everything written after that backup is lost.

## Production deployment

DepotManagement runs on a Linux server as one systemd service: a single Node process (`next start`) bound to `127.0.0.1`, behind Nginx, which terminates TLS. Example files: [deploy/systemd/depotmanagement.service](deploy/systemd/depotmanagement.service) and [deploy/nginx/depotmanagement.conf](deploy/nginx/depotmanagement.conf). The names below are placeholders: host `depot.example.com`, service user `depot`, checkout `/home/depot/apps/DepotManagement`, port `3000`.

### Prerequisites

- Linux with systemd
- Node.js 24 LTS and npm 11. If Node is not on systemd's default `PATH` (e.g. installed under `/opt/node-24`), set `Environment=PATH=` in the unit and use the same Node when deploying; a per-user version manager such as nvm is not on that path
- Git, curl, Nginx and certbot
- A domain name whose DNS A/AAAA record points to the server, with ports 80 and 443 reachable
- Network access during the build: `next build` downloads the Roboto font

### Service user and data directories

Use a user of its own, so other apps on the server cannot read the financial data. The database, backups and data files live outside the checkout, owned by that user:

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin depot
sudo install -d -o depot -g depot -m 0700 /var/lib/depotmanagement \
  /var/lib/depotmanagement/backups /var/lib/depotmanagement/data
sudo -u depot -H mkdir -p /home/depot/apps
sudo -u depot -H git clone <repository-url> /home/depot/apps/DepotManagement
```

### Configuration

Create the env file outside the repository, readable by root only. systemd reads it as root before it starts the app as the service user, so the app gets every value without being able to read the file:

```sh
sudo install -d -m 0755 /etc/depotmanagement
sudo install -m 0600 /home/depot/apps/DepotManagement/.env.example /etc/depotmanagement/depotmanagement.env
sudoedit /etc/depotmanagement/depotmanagement.env
```

Set at least:

```sh
DATABASE_URL=file:/var/lib/depotmanagement/depot.db
BACKUP_DIR=/var/lib/depotmanagement/backups
DATA_DIR=/var/lib/depotmanagement/data
AUTH_USERNAME=...
AUTH_PASSWORD_HASH=$2b$12$...
SESSION_SECRET=...
```

- Paths must be absolute: relative paths resolve against the checkout, and `~` is not expanded.
- `AUTH_PASSWORD_HASH` holds the **plain** hash. Create it on a machine with a full install (`npm run -s hash-password`); it prints every `$` written as `\$` for `.env`, so remove those backslashes here. systemd reads the file without shell expansion. Never `source` the file in a shell, because the hash contains `$`.
- `SESSION_SECRET`: a new value for production, `openssl rand -base64 48`.
- `PORT` (default 3000) changes the port, e.g. when other apps on the server use 3000; the Nginx `proxy_pass` and `DEPOT_URL` for the deploy script must match.
- Do not create a `.env` in the checkout; the service gets its whole configuration from this file.

### systemd service

```sh
sudo cp /home/depot/apps/DepotManagement/deploy/systemd/depotmanagement.service /etc/systemd/system/
sudoedit /etc/systemd/system/depotmanagement.service   # adapt user, paths, PATH
sudo systemctl daemon-reload
sudo systemctl enable depotmanagement
```

The unit runs [scripts/start.sh](scripts/start.sh) as `depot` with `NODE_ENV=production` and `NEXT_TELEMETRY_DISABLED=1`. The script runs `prisma migrate deploy` and only if it succeeds replaces itself with `next start --hostname 127.0.0.1` (one process, no cluster). The service restarts on failure; its output goes to journald.

### Deploying

[scripts/deploy.sh](scripts/deploy.sh) runs as the service user, from the checkout:

1. While the service still runs: refuses a checkout with local changes (someone edited on the server) and a missing or empty database, then fast-forwards to `origin/main`.
2. Stops the service, copies the database to `BACKUP_DIR` as `predeploy-<timestamp>.sqlite` (the newest 5 are kept; the daily backups are not touched), runs `npm ci`, removes `.next` and builds.
3. Starts the service (the migrations run on start), waits until it answers and checks that an anonymous request is redirected to `/login`. If the login gate is not live, it stops the service again.

Any failure exits with an error and leaves the service **stopped**; a half-finished build is never restarted, because it could serve pages without the login gate. The message names the previous commit and the database copy for a rollback: `git -C <checkout> reset --hard <commit>`, then rerun with `DEPOT_NO_PULL=1`.

Settings (environment): `DEPOT_URL` (default `http://127.0.0.1:3000`, must match `PORT`), `DEPOT_DATABASE` and `DEPOT_BACKUP_DIR` (default the paths above, must match the env file), `DEPOT_SERVICE` (default `depotmanagement`), `DEPOT_BRANCH` (default `main`), `DEPOT_PREDEPLOY_KEEP` (default 5), `DEPOT_START_TIMEOUT` (seconds, default 60), `DEPOT_NO_PULL=1`, and `DEPOT_FIRST_DEPLOY=1` for the very first deploy, when no database exists yet. The script cannot read the root-only env file, so a small wrapper keeps the server's values in one place, e.g. `/usr/local/bin/deploy-depotmanagement`:

```sh
#!/bin/sh
exec sudo -u depot -H env PATH=/opt/node-24/bin:/usr/local/bin:/usr/bin:/bin \
  DEPOT_URL=http://127.0.0.1:3000 "$@" /home/depot/apps/DepotManagement/scripts/deploy.sh
```

Arguments are passed to `env` before the script, so `deploy-depotmanagement DEPOT_FIRST_DEPLOY=1` sets a variable for one run. Drop the `PATH=` part if Node is on the default `PATH`.

The service user needs sudo rights to stop and start the service and read its log without a password prompt, and nothing else; the script calls `sudo -n`, so a missing rule fails at once instead of prompting. Check the paths with `command -v systemctl journalctl`, then add a rule with `sudo visudo -f /etc/sudoers.d/depotmanagement`:

```text
depot ALL=(root) NOPASSWD: /usr/bin/systemctl stop depotmanagement, /usr/bin/systemctl start depotmanagement, /usr/bin/journalctl -u depotmanagement -n 40 --no-pager
```

The rule must name the same service as `DEPOT_SERVICE`. First deploy:

```sh
sudo chmod 755 /usr/local/bin/deploy-depotmanagement
deploy-depotmanagement DEPOT_FIRST_DEPLOY=1
```

### Nginx and TLS

```sh
sudo cp /home/depot/apps/DepotManagement/deploy/nginx/depotmanagement.conf /etc/nginx/sites-available/
sudoedit /etc/nginx/sites-available/depotmanagement.conf   # replace depot.example.com, port
sudo ln -s /etc/nginx/sites-available/depotmanagement.conf /etc/nginx/sites-enabled/
sudo certbot certonly --webroot -w /var/www/html -d depot.example.com --deploy-hook "systemctl reload nginx"
sudo nginx -t && sudo systemctl reload nginx
```

On distributions without `sites-available`, copy the file to `/etc/nginx/conf.d/`. Until the certificate exists, `nginx -t` fails on the `ssl_certificate` paths: comment out the `443` server block, get the certificate, then enable it again. The certificate is requested with certbot's webroot method, which needs no certbot Nginx plugin; port 80 keeps serving `/.well-known/acme-challenge/` from `/var/www/html` so renewals work. With the plugin installed (`python3-certbot-nginx`), `certbot certonly --nginx` works as well. Nginx older than 1.25.1 rejects `http2 on;`: write `listen 443 ssl http2;` instead (see the comment in the example). The example block:

- redirects port 80 to HTTPS (except the certbot challenge) and sends an HSTS header;
- forwards `Host`, `X-Forwarded-Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. The session cookie is `Secure` only when `X-Forwarded-Proto` is `https`, and server actions check the browser's origin against the forwarded host;
- allows uploads of 64 MB (`client_max_body_size`), at least the 60 MB limit of Next.js server actions in [next.config.ts](next.config.ts);
- waits up to 300 s for the app, enough for large imports and restores.

Open `https://depot.example.com` and log in.

### Updating

```sh
deploy-depotmanagement
```

The app is down while it installs and builds, usually a minute or two.

### Logs

```sh
sudo journalctl -u depotmanagement -f
```

### Moving local data to production

1. On the local instance: Settings → "Datensicherung" → "Exportieren" (see [Data export](#data-export)).
2. Start the production instance (first deploy) and log in.
3. On production: Settings → "Datensicherung" → "Wiederherstellen" with that file (see [Restore](#restore)).

Restore replaces all data. If the production instance already held data, it is kept as the automatic pre-restore export in its `BACKUP_DIR`. Delete the export file from your local machine when you no longer need it, because it contains all your financial data.

### Backups

The daily database backup (see [Daily database backup](#daily-database-backup)) and the pre-deploy copies go to `BACKUP_DIR`. `/var/lib/depotmanagement/backups` is on the same disk as the database, so keep a copy elsewhere: download an export regularly (Settings → "Datensicherung" → "Exportieren"), or copy `BACKUP_DIR` to another machine.

## Definition of Done (UI stories)

Every UI story is done only when all of these hold:

- Microcopy is German, short and factual, numbers first. Confirmations name the Depot and Security, never a generic "Element" or "Eintrag".
- No optimistic writes: the UI updates only after the server confirms.
- No hover-only actions.
- Dialogs are at most one level deep.
- Enter submits a form; Esc closes the topmost dialog.
- WCAG 2.2 AA on desktop and phone; forms are fully keyboard-operable; tables use proper header semantics.
- Touch targets are at least 44 px.
- Gain/Loss always shows a sign and an arrow, never color alone.

## Privacy

Never commit personal financial data to this repository. This includes broker documents, CSV exports, databases and API keys. Most of these are excluded by [.gitignore](.gitignore). `npm run check:tracked` ([scripts/check-tracked-files.mjs](scripts/check-tracked-files.mjs)) fails and names the file when git tracks, anywhere in the repository, an env file (`.env`, `.env.*` or `*.env`, any case; `.env.example` is allowed), a SQLite file (`*.db`, `*.sqlite`, `*.sqlite3` and their `-wal`/`-shm`/`-journal` files), a CSV or a PDF; `npm test` runs the same check. Test fixtures are named `*.csv.txt` / `*.txt`.

## License

[MIT](LICENSE)
