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
cp .env.example .env     # fill in values as later features need them
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

The `dev`, `build` and `start` scripts set `NEXT_TELEMETRY_DISABLED=1`, so Next.js telemetry is off. The app embeds no analytics.

### Source tree

```text
src/
  app/        # Next.js routes and pages (thin); _components/ holds the app shell
  core/       # pure functions (decimal.js only; enforced by test/architecture)
  modules/    # services per domain module (ledger, import, ...), added by later stories
  db/         # Prisma client singleton (WAL, busy timeout) and database URL resolution
  theme/      # "Minze" MUI theme and design tokens
prisma/       # schema.prisma and migrations/
test/
  architecture/  # dependency guards
  fixtures/      # synthetic, anonymised fixtures only (*.csv.txt / *.txt)
```

## Configuration

All configuration comes from environment variables or an untracked `.env`. [.env.example](.env.example) lists every name without values: `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `BACKUP_DIR`, `BACKUP_KEEP`, `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`, `DATA_DIR`.

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
