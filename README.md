# DepotManagement

A self-hosted portfolio tracker for private investors with several securities accounts (Depots). It is a personal replacement for commercial trackers such as Parqet, so your financial data stays on your own machine or server.

> **Status:** Early development. The app shell runs; features follow story by story.

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
| `npm start` | `prisma migrate deploy`, then the production server. The app never migrates itself. |
| `npm test` | Vitest unit and architecture tests |
| `npm run lint` | ESLint (`eslint-config-next`, core-web-vitals and TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
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

All configuration comes from environment variables or an untracked `.env`. [.env.example](.env.example) lists every name without values: `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `BACKUP_DIR`, `BACKUP_KEEP`, `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`, `DATA_DIR`.

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
| `schemaVersion` | The number `1` | — |
| `depots` | `id`, `name`, `broker` (`COMDIRECT`/`DEUTSCHE_BANK`/`FINANZEN_ZERO`), `archived` | `id` |
| `securities` | `id`, `isin`, `cryptoSymbol`, `name`, `assetType` | `id` |
| `providerMappings` | `id`, `securityId`, `provider` (`YAHOO`/`ONVISTA`/`COINGECKO`), `symbol`, `origin` (`AUTO`/`MANUAL`), `updatedAt`, `historyFrom`, `fetchedAt`, `fetchError`; provider and symbol `null` = "not found" marker | `securityId` |
| `transactions` | `id`, `depotId`, `securityId`, `type` (`BUY`, `SELL`, `DIVIDEND`, `FEE`, `TAX`, `DEPOSIT`, `WITHDRAWAL`, `ADJUSTMENT`), `date`, `sequence`, `quantity`, `price`, `amount`, `fee`, `tax`, `note` | `depotId`, `date`, `sequence` |
| `corporateActions` | `id`, `securityId`, `newSecurityId`, `type` (`SPLIT`/`ISIN_CHANGE`), `date`, `ratioOld`, `ratioNew` | `securityId`, `type`, `date` |
| `reconciliationRuns` | `id`, `depotId`, `statementDate`, `status` (`OPEN`/`FINISHED`), `createdAt`, `finishedAt`, `rows`: [`id`, `runId`, `securityId` (`null` = Cash Account), `statementValue`, `checked`] | `id`; rows by `id` |
| `prices` | `id`, `securityId`, `date`, `source` (`MANUAL`/`PROVIDER`), `price`, `fetchedAt` | `securityId`, `date`, `source` |
| `logos` | Manually uploaded logos only: `id`, `securityId`, `contentType` (`image/png`/`image/jpeg`/`image/webp`), `fetchedAt`, `data` (file bytes as base64) | `securityId` |

Not exported: caches and anything that can be fetched again or is temporary: fetched logos and their "nothing found" markers, news headlines, PDF import staging (batches, items, stored PDFs). A manual logo whose file is missing, empty or otherwise unusable on disk is skipped with a warning in the log.

`schemaVersion` changes only when the format changes incompatibly. Restore reads older versions by upgrading them step by step to the current one.

### Restore

Settings → "Datensicherung" → "Wiederherstellen" replaces **all** data with the content of an export file. Choose the file and type `WIEDERHERSTELLEN` to enable the button. Restore never merges: afterwards the database holds exactly the rows of the file.

- Replaced: Depots, Securities, Transactions, corporate actions, reconciliation runs, provider mappings, Prices and manual logos, with their IDs, sequences, decimals and dates exactly as in the file.
- Cleared: PDF import staging (batches and their stored PDFs), news headlines and fetched logos. They are fetched or uploaded again as needed.
- Before anything is replaced, an automatic export of the current data is written to `BACKUP_DIR` (empty = `~/.depotmanagement/backups`; the directory is created if missing) as `depotmanagement-export-<YYYYMMDD-HHMMSS>.json`. The success message names this file. To undo a restore, restore that file.
- The file is checked completely before anything is written: at most 50 MB, valid JSON, a supported `schemaVersion` (older versions are upgraded step by step, newer ones are rejected), the schema above, consistent references and unique keys, and valid logo images. A rejected file shows the reason (and, for schema or consistency errors, the field path) and leaves every row and file unchanged.
- The replacement runs in one database transaction; if it fails, the old data stays as it was.

Moving data from a local instance to production: export on the local instance, then restore that file on the production instance (after its first start and login). The production instance's previous content, if any, is kept as the automatic pre-restore export in its `BACKUP_DIR`.

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

Never commit personal financial data to this repository. This includes broker documents, CSV exports, databases and API keys. Most of these are excluded by [.gitignore](.gitignore).

## License

[MIT](LICENSE)
