---
title: 'Production deployment behind Nginx (story 6-4)'
type: 'feature'
created: '2026-10-26'
status: 'awaiting-operator'
baseline_revision: '5a84ad972ac6504e819afe24c3a02d208b614e0e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
deferred: []
operator_actions:
  - "Register or choose a domain name for the app and publish a DNS A/AAAA record pointing it at the Linux server; make ports 80 and 443 reachable."
  - "On the server, install Node.js 24 LTS system-wide, Git, Nginx and certbot."
  - "Follow README 'Production deployment': create the service user and /var/lib/depotmanagement directories, clone the repo to /opt/depotmanagement, and write /etc/depotmanagement/depotmanagement.env (0600) with real SESSION_SECRET, AUTH_USERNAME, plain AUTH_PASSWORD_HASH and absolute DATABASE_URL/BACKUP_DIR/DATA_DIR."
  - "Install and adapt deploy/systemd/depotmanagement.service, add the sudoers rule for systemctl stop/start, enable the unit and run scripts/deploy.sh as the service user; confirm with systemctl status and journalctl -u depotmanagement."
  - "Install deploy/nginx/depotmanagement.conf with the real host name, obtain the certificate with certbot (with the reload deploy hook), run nginx -t and reload Nginx."
  - "Open https://<your-host>, log in, and confirm the session cookie is Secure and a PDF batch upload and a restore upload pass through Nginx."
  - "Move local data: export on the local instance (Settings -> Datensicherung -> Exportieren) and restore that file on production, then delete the local export file."
  - "Point BACKUP_DIR at (or regularly copy it to) another disk or off-site location."
---

<intent-contract>

## Intent

**Problem:** DepotManagement only runs on Tommy's machine; there is no documented, repeatable way to run it on his Linux server behind Nginx with TLS, and nothing stops `.env`, SQLite files or Parqet CSVs from being committed to the public repo.

**Approach:** Add a start script (migrate, then `next start` on 127.0.0.1 as the single process), a deploy script (stop service, install, build, start service), an example systemd unit and an example Nginx server block under `deploy/`, a tracked-files check script wired into `npm test`, and a README "Production deployment" section that ties them together, including the local→production move via export/restore.

## Boundaries & Constraints

**Always:**
- `scripts/start.sh` (POSIX `sh`, executable, `set -eu`): `cd` to the repo root (parent of the script's dir), prepend `<root>/node_modules/.bin` to `PATH`, export `NEXT_TELEMETRY_DISABLED=1`, run `prisma migrate deploy`; only if it succeeds `exec next start --hostname 127.0.0.1 --port "${PORT:-3000}"` (exec, so the systemd main PID is the Node server — exactly one process). `npm start` runs this script.
- `scripts/deploy.sh` (POSIX `sh`, executable, `set -eu`): from the repo root, `sudo systemctl stop <service>`, `npm ci`, `npm run build`, `sudo systemctl start <service>`; service name from `DEPOT_SERVICE` (default `depotmanagement`). Any failing step stops the script with a non-zero exit and leaves the service stopped; it prints one line per step and, at the end, the `journalctl -u <service>` hint. The migration runs in `start.sh` when the service starts — the app never migrates itself.
- `scripts/check-tracked-files.mjs`: lists `git ls-files -z` of the repo it runs in (cwd) and exits 1, printing each offending path, when a tracked path matches: a `.env` or `.env.*` basename other than `.env.example`; a SQLite file `*.db`, `*.sqlite`, `*.sqlite3` or their `-wal`/`-shm`/`-journal` side files; `*.csv` (any Parqet export; fixtures are `*.csv.txt`); `*.pdf`. Case-insensitive on the extension. Exit 0 with no output otherwise; exit 2 if `git` fails. `npm run check:tracked` runs it.
- `deploy/systemd/depotmanagement.service`: `User=`/`Group=` a dedicated user, `WorkingDirectory=` the checkout, `EnvironmentFile=/etc/depotmanagement/depotmanagement.env` (outside the repo), `ExecStart=<checkout>/scripts/start.sh`, `Restart=on-failure` with `RestartSec`, `StandardOutput=journal`, `StandardError=journal`, `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, basic hardening (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`), `WantedBy=multi-user.target`. Comments explain each path to adapt.
- `deploy/nginx/depotmanagement.conf`: port 80 redirects to HTTPS; 443 `ssl` with `http2`, certificate paths under `/etc/letsencrypt/live/<host>/`, `server_name` placeholder `depot.example.com`; `client_max_body_size` ≥ the Next `serverActions.bodySizeLimit` (60 MB) and `proxyClientMaxBodySize`; `proxy_pass http://127.0.0.1:3000`; forwards `Host`, `X-Forwarded-Host`, `X-Forwarded-For`, `X-Forwarded-Proto $scheme` (session cookie `Secure` and the server-action origin check depend on them); `proxy_read_timeout`/`proxy_send_timeout` ≥ 300s for large imports and restores; HSTS header.
- Production data paths are absolute and outside the checkout (`/var/lib/depotmanagement/{depot.db,backups,data}`), owned by the service user, mode 0700 dirs; the env file is 0600.
- README: no real host names, user names, IPs, credentials or keys — placeholders only (`depot.example.com`, user `depot`, `/opt/depotmanagement`).

**Never:**
- Let the app run `prisma migrate` itself, start a second process (cluster, PM2, `next start` without `exec`), or bind to anything but 127.0.0.1.
- Source the env file in a shell (bcrypt hashes contain `$`); systemd reads it without expansion, so it holds the plain hash.
- Add CI services, Docker, a `.gitignore` exception, analytics, or change runtime app code (`src/`) beyond what a test needs. Touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start | Fake `prisma` and `next` succeed, `PORT` unset | `prisma migrate deploy` runs, then `next start --hostname 127.0.0.1 --port 3000` with `NEXT_TELEMETRY_DISABLED=1`; exit code is `next`'s | — |
| Start with port | `PORT=3100` | `--port 3100` | — |
| Migration fails | Fake `prisma` exits 1 | `next` never runs; script exits non-zero | stderr from prisma |
| Deploy | Fake `sudo`/`systemctl`/`npm` succeed | Calls in order: stop service, `npm ci`, `npm run build`, start service | — |
| Deploy build fails | Fake `npm run build` exits 1 | No `systemctl start`; non-zero exit | message names the failed step |
| Deploy custom service | `DEPOT_SERVICE=depot-test` | stop/start target `depot-test` | — |
| Tracked clean | Repo tracks `.env.example`, `a.csv.txt`, `x.txt`, `README.md` | Exit 0, no output | — |
| Tracked forbidden | Repo tracks `.env`, `config/.env.local`, `depot.db`, `b.SQLITE`, `depot.db-wal`, `export.csv`, `doc.pdf` | Exit 1, each path printed | — |
| Not a repo | cwd outside git | Exit 2 | message, no stack trace |
| This repo | `git ls-files` of DepotManagement | Exit 0 | — |

</intent-contract>

## Code Map

- `package.json` -- `start` currently `prisma migrate deploy && NEXT_TELEMETRY_DISABLED=1 next start` (binds 0.0.0.0) → `sh scripts/start.sh`; add `check:tracked`.
- `next.config.ts` -- `serverActions.bodySizeLimit: "60mb"`, `proxyClientMaxBodySize: "60mb"`: the Nginx limit must be at least this.
- `test/architecture/next-config.test.ts` -- `bytes()` size parser pattern (copy, do not import across tests if awkward); add sibling tests in `test/architecture/` or `test/deploy/`.
- `src/modules/auth/session.ts:63` `isHttpsRequest` reads `x-forwarded-proto` → `Secure` cookie; Nginx must set it.
- `prisma.config.ts` -- loads `dotenv/config` (cwd `.env`) and `resolveDatabaseUrl`; with systemd the env comes from `EnvironmentFile`, so no `.env` in the checkout.
- `src/db/database-url.ts` -- relative `file:` URLs resolve against cwd (= checkout): production must use absolute paths.
- `.env.example` -- variable list (AD-18); the production env file is a copy with absolute paths.
- `README.md` -- existing sections "Installation", "Scripts" table (update `npm start` row, add `check:tracked`), "Login" (plain hash for systemd), "Restore" (has the local→production paragraph — move it into the new section or link), "Daily database backup", "Privacy" (mention the check).
- `scripts/hash-password.mjs` -- style reference for `.mjs` scripts (shebang, header comment).
- `vitest.config.ts` -- includes `test/**/*.test.ts`; Node env. `tsconfig` has `allowJs: false`: test scripts black-box via `child_process` (`spawnSync`), never import `.mjs`.

## Tasks & Acceptance

**Execution:**
- `scripts/start.sh` -- new, mode 755 -- migrate then exec `next start` on 127.0.0.1.
- `scripts/deploy.sh` -- new, mode 755 -- stop, `npm ci`, build, start via systemd.
- `scripts/check-tracked-files.mjs` -- new -- forbidden tracked-file check.
- `package.json` -- `start` → `sh scripts/start.sh`; add `"check:tracked": "node scripts/check-tracked-files.mjs"`.
- `deploy/systemd/depotmanagement.service` -- new example unit.
- `deploy/nginx/depotmanagement.conf` -- new example server block.
- `README.md` -- new "Production deployment" section: prerequisites (Linux, Node 24 system-wide in systemd's PATH, Nginx, certbot, network for the build), service user and data dirs, clone to `/opt/depotmanagement`, env file at `/etc/depotmanagement/depotmanagement.env` (0600, absolute `DATABASE_URL`/`BACKUP_DIR`/`DATA_DIR`, plain password hash, no `.env` in the checkout), install unit, first deploy via `scripts/deploy.sh` (sudoers hint for stop/start only), Nginx + certificate, updating (`git pull` + `scripts/deploy.sh`; a short downtime), logs (`journalctl -u depotmanagement`), moving local data (export locally → first login on production → restore), backups (`BACKUP_DIR` off-disk advice links existing section). Update Scripts table, Privacy section (`npm run check:tracked`, also run by `npm test`) and the status line.
- `test/deploy/start-script.test.ts` -- copy `scripts/start.sh` into a temp dir with fake `node_modules/.bin/{prisma,next}` that log args and env; cover Start rows of the matrix.
- `test/deploy/deploy-script.test.ts` -- copy `scripts/deploy.sh` into a temp dir; fake `sudo` (exec its args), `systemctl`, `npm` on a prepended `PATH` logging calls; cover Deploy rows.
- `test/deploy/check-tracked-files.test.ts` -- temp git repos (`git init`, `git add` of empty files) for clean/forbidden/not-a-repo rows; plus this repo exits 0.
- `test/deploy/deploy-examples.test.ts` -- parse the example files: Nginx `client_max_body_size` ≥ both Next limits, `proxy_pass http://127.0.0.1:3000`, required `proxy_set_header`s, `ssl`, 80→443 redirect; unit has `Restart=on-failure`, `EnvironmentFile=` not under `WorkingDirectory`, `ExecStart=` ending in `scripts/start.sh`, `StandardOutput=journal`; start script contains no `0.0.0.0`.

**Acceptance Criteria:**
- Given a Linux server with Node 24 and Nginx, when Tommy follows the README "Production deployment" section, then `scripts/deploy.sh` installs dependencies, builds and starts the service, whose `scripts/start.sh` runs `prisma migrate deploy` and then a single `next start` bound to 127.0.0.1.
- Given the README, when a reader looks for moving local data to production, then it describes export on the local instance and restore on the production instance.
- Given a tracked `.env`, SQLite file or CSV, when `npm test` or `npm run check:tracked` runs, then it fails and names the file.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 28 findings — high 0, medium 0, low 25, false 3, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: deploy.sh prints "Deployed." although `systemctl start` (Type=simple) succeeds before start.sh's migration can fail — fixed: final line now says the service was started, migrations run on start, and points to `systemctl status`/`journalctl`.
  - `[low]` `[patch]` Blind: with RestartSec=5 a failing migration restarts forever (default start limit never hit) — fixed: `StartLimitIntervalSec=300`, `StartLimitBurst=5` in [Unit]; test asserts them.
  - `[low]` `[reject]` Blind: check misses `depotmanagement-export-*.json`, `*.pem`/`*.key` — not in the AC (env, SQLite, Parqet CSV); exports land in BACKUP_DIR/Downloads outside the repo; extra rules add branches for an unlikely case.
  - `[low]` `[reject]` Blind: check runs only via `npm test`, no pre-commit/CI; fails in a non-git tarball — AC accepts "script or CI step"; the repo and the server are always git checkouts.
  - `[low]` `[patch]` Blind: no `UMask`; files created world-readable once BACKUP_DIR/DATA_DIR move out of the 0700 dirs — fixed: `UMask=0077` in the unit; test asserts it. (Rest of the hardening suggestion — ProtectSystem=strict — rejected: needs per-path ReadWritePaths that vary with the env file.)
  - `[low]` `[reject]` Blind: `npm ci`/build without the env file create an empty `~/.depotmanagement` in the service user's home — harmless empty directory; fixing it means loading the env file in a shell, which the spec forbids.
  - `[low]` `[reject]` Blind: downtime and no rollback on a failed deploy — deliberate (Design Notes); recovery is `git checkout <previous>` + rerun, obvious from the README.
  - `[low]` `[patch]` Blind: `DEPOT_SERVICE` not tied to the sudoers rule; `sudo` without `-n` can hang at a prompt — fixed: `sudo -n`, README sentence that the rule must name the same service; fake sudo in the test drops `-n`.
  - `[low]` `[reject]` Blind: README lacks production-specific steps for restoring a daily DB backup — the existing steps cover ownership and note that the service start runs the migration; a server variant duplicates them.
  - `[low]` `[patch]` Blind: `certbot certonly` renewals may not reload Nginx; bootstrap clumsy — fixed: `--deploy-hook "systemctl reload nginx"` in README and conf comment; bootstrap stays documented (comment out 443 until the certificate exists).
  - `[low]` `[patch]` Blind: test gaps (-shm/-journal, .sqlite3, uppercase/nested CSV/PDF, unit NODE_ENV/telemetry; weak 0.0.0.0 string test) — fixed: cases added to the tracked-files and unit tests; the 0.0.0.0 test kept as is (the first start test already asserts `--hostname 127.0.0.1`).
  - `[low]` `[patch]` Edge: unbounded restart loop — same root cause as Blind row 2; fixed there.
  - `[low]` `[patch]` Edge: "Deployed." after a failed start — same as Blind row 1; fixed there.
  - `[low]` `[patch]` Edge: env files named `depotmanagement.env`/`production.env` not caught — fixed: names ending in `.env` are forbidden (except `.env.example`); test case added.
  - `[low]` `[reject]` Edge: export JSON / `.xlsx` not caught — same reasoning as Blind row 3.
  - `[low]` `[patch]` Edge: `.ENV`/`.Env.local` slip through — fixed: env rule compares the lowercased name; test case added.
  - `[low]` `[patch]` Edge: run from a subdirectory, `git ls-files` lists only that subtree — fixed: `git ls-files -z --full-name -- :/`; subdirectory test added.
  - `[low]` `[reject]` Edge: "passes for this repository" test fails without `.git` — same as Blind row 4.
  - `[false]` `[reject]` Edge: GIT_DIR/GIT_INDEX_FILE set inside a git hook — the repo has no hooks running `npm test`, and inside a hook those variables point at this same repository.
  - `[low]` `[reject]` Edge: stray `~/.depotmanagement` from `npm ci` — same as Blind row 6.
  - `[false]` `[reject]` Edge: Nginx 502 when PORT changes — the README ("the Nginx `proxy_pass` must match") and the conf comment ("PORT in the env file must match") already say so.
  - `[low]` `[patch]` Edge: sudoers vs DEPOT_SERVICE / systemctl path — same as Blind row 8; fixed there.
  - `[low]` `[patch]` Edge claim: README/script imply success after a failed migration — same as Blind row 1; fixed there.
  - `[low]` `[patch]` Verification gap: `package.json` `scripts.start` not pinned by any test — fixed: test asserts `sh scripts/start.sh`.
  - `[low]` `[patch]` Intent: the human-only steps (server, domain/DNS, certificate, secrets, first deploy, data move) are owed but not recorded — handled in finalization: status `awaiting-operator` with `operator_actions`.
  - `[low]` `[patch]` Intent: README never mentions a domain/DNS record although certbot needs one — fixed: prerequisite added (domain with A/AAAA record, ports 80/443 reachable).
  - `[false]` `[reject]` Intent: `npm start` now binds to 127.0.0.1 locally too — intended by the spec; local use goes through localhost and `npm run dev` is unchanged.
  - `[low]` `[reject]` Intent: migration runs in start.sh, not as a deploy step — deliberate (Design Notes): only the start path has the production environment; AD-18 "deploy/start script" is met.

## Design Notes

Migration lives in `start.sh`, not `deploy.sh`: only the start path reliably has the production environment (systemd `EnvironmentFile`), and it applies pending migrations right before the server starts — after a deploy and after restoring an older DB backup alike. `deploy.sh` stops the service first because `npm ci` replaces `node_modules` and `next build` rewrites `.next`, both of which break a running server; a minute of downtime is fine for one user.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.
- `npm run check:tracked` -- expected: exit 0.
- `sh -n scripts/start.sh scripts/deploy.sh` -- expected: no syntax errors.

## Auto Run Result

Status: awaiting-operator

**Summary:** Production deployment for a Linux server behind Nginx. `scripts/start.sh` (now `npm start`) runs `prisma migrate deploy` and then `exec`s a single `next start --hostname 127.0.0.1 --port ${PORT:-3000}` with telemetry off. `scripts/deploy.sh` stops the systemd service, runs `npm ci` and `npm run build`, and starts the service again (`sudo -n`, `DEPOT_SERVICE`). Example systemd unit (env file in `/etc`, restart on failure with a start limit, journald, `UMask=0077`, basic hardening) and Nginx server block (80→443, TLS/HTTP2, HSTS, 64 MB uploads ≥ the 60 MB Next limits, forwarding headers, 300 s timeouts). `scripts/check-tracked-files.mjs` (`npm run check:tracked`, also exercised by `npm test`) fails on tracked env files, SQLite files, CSVs and PDFs. README "Production deployment" covers prerequisites (incl. domain/DNS), service user and data dirs outside the checkout, env file, unit, sudoers, Nginx + certbot, updating, logs, local→production data move via export/restore, and backups.

**Files changed:**
- `scripts/start.sh`, `scripts/deploy.sh` (new) — start and deploy scripts.
- `scripts/check-tracked-files.mjs` (new) — forbidden tracked-file check.
- `deploy/systemd/depotmanagement.service`, `deploy/nginx/depotmanagement.conf` (new) — examples.
- `package.json` — `start` → `sh scripts/start.sh`; `check:tracked`.
- `README.md` — production deployment section, Scripts table, Privacy, status line.
- `test/deploy/*.test.ts` (new, 4 files) — scripts against fakes, tracked-files check in temp repos and this repo, example files and `package.json` invariants.

**Review findings:** one pass, 28 findings (high 0, medium 0, low 25, false 3). Patched (all low): start limit, `UMask`, honest final deploy message, `sudo -n` + sudoers/DEPOT_SERVICE note, certbot reload hook, domain/DNS prerequisite, env-file rule (case-insensitive, `*.env`), whole-repo `ls-files`, extra test cases, `scripts.start` test; human-only steps recorded as `operator_actions`. 0 deferred. Rejected findings and reasons are in the Review Triage Log.

**Follow-up review recommended:** false — patched 0 high, 0 medium, 13 low.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (183 test files, 2515 tests); `npm run check:tracked` exit 0; `sh -n` on both scripts OK. Every I/O matrix row is covered by a passing test in `test/deploy/`.

**Operator actions owed:** see `operator_actions` in the frontmatter — domain/DNS, server setup, env file with real secrets, unit + sudoers + first deploy, Nginx + certificate, HTTPS smoke test, export→restore data move, off-disk backups.

**Residual risks:** nothing ran on a real Linux server; the unit and Nginx block are checked by text tests only (no `nginx -t`/`systemd-analyze verify`); `http2 on;` needs Nginx ≥ 1.25.1 (comment gives the older form); deploy has a short downtime and no automatic rollback.
