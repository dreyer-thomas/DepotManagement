---
title: 'DW-21: Re-authorizing a client revokes its older grants'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: 'ddd1526bf9de631825726d36b4700e4fa1798499'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `exchangeCode` (`src/modules/mcp/tokens.ts`) always creates a new `OAuthGrant` and never revokes the same client's older active grants, so re-authorizing a still-connected client (e.g. after "Depotzugriff entfernen" and reconnecting) leaves two active grants and Settings › Verbundene Apps shows two cards for one app.

**Approach:** Human decision (DW-21, option 1): inside the existing `exchangeCode` transaction, after creating the new grant, call `revokeGrant` for every other grant with the same `clientId` and `revokedAt = null`. The latest consent replaces earlier ones.

## Boundaries & Constraints

**Always:** Revocation runs in the same transaction as the grant creation (use `tx`, timestamp `issuedAt`). Reuse `revokeGrant` (sets `revokedAt`, deletes all codes/tokens of the grant). The new grant and its token pair are untouched and work.

**Never:** Do not touch grants of other clients. Do not change the refresh-token flow, code-replay handling, or `disconnectApp`/`removePortfolioAccess`. No schema/migration change. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-authorize connected client | Client A has active grant G1 with token pair P1; A exchanges a new code | New grant G2 + pair P2 issued; G1 `revokedAt = issuedAt`, all G1 tokens deleted; P1 access token → `verifyAccessToken` null, P1 refresh → `invalid_grant`; P2 works | No error expected |
| Other client connected | Client B has active grant GB; A re-authorizes | GB stays active, its tokens work | No error expected |
| First authorization | A has no grant | Behaves as before (one grant) | No error expected |
| Failed exchange | A has G1; code exchange fails (bad verifier / replay) | G1 untouched (except existing replay rule that revokes the grant created from the replayed code) | invalid_grant as before |

</intent-contract>

## Code Map

- `src/modules/mcp/tokens.ts` -- `exchangeCode` (~line 178): transaction creates `grant` via `tx.oAuthGrant.create`, links the consumed code, then `issueTokenPair`. Insert the revocation after `create` (before or after linking the code; before `issueTokenPair` is fine since the filter excludes `grant.id`). `revokeGrant(grantId, db, now)` at ~line 36. Update the file-header / `exchangeToken` doc comment to mention it.
- `src/modules/mcp/grants.ts` -- `listConnectedApps` lists `revokedAt = null` grants (Settings cards); read-only, header comment may mention re-authorization replaces the old grant.
- `src/modules/mcp/oauth.test.ts` -- helpers `register`, `code`, `exchange`, `tokens`, `at`, `MINUTE`; "token endpoint" describe block.
- `src/modules/mcp/grants.test.ts` -- helpers `register(name)`, `connect(clientId, now, redirect, portfolioRead)`, `refresh(clientId, token)`; existing "lets a disconnected client reconnect" test in `disconnectApp`.

## Tasks & Acceptance

**Execution:**
- `src/modules/mcp/tokens.ts` -- in `exchangeCode`, after creating the grant, find all `oAuthGrant` rows with `clientId: client.id, revokedAt: null, id: { not: grant.id }` and `revokeGrant(id, tx, () => issuedAt)` each; update doc comments -- one active grant per client.
- `src/modules/mcp/oauth.test.ts` -- add a "token endpoint" test: client re-authorizes; old grant revoked at the new issuance time, its tokens deleted, old access token refused, old refresh token `invalid_grant`, new pair works (access verifies, refresh rotates); a second client's grant stays active.
- `src/modules/mcp/grants.test.ts` -- add a test: connected client with `portfolio:read`, `removePortfolioAccess`, reconnect with `portfolio:read` → `listConnectedApps` returns exactly one card (the new grant, scopes `watchlist, portfolio:read`).

**Acceptance Criteria:**
- Given a client with an active grant, when it completes a new authorization-code exchange, then Settings (`listConnectedApps`) shows exactly one card for that client, backed by the new grant.
- Given the scenarios in the I/O matrix, when the tests run, then all pass and existing MCP tests stay green.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 18 findings — high 0, medium 0, low 6, false 9, maybe-false 3
- findings:
  - `false` `reject` Concurrent sessions sharing one client_id cancel each other — intended: the human decision mandates revoking every other active grant of the same clientId.
  - `false` `reject` A narrower re-consent drops a broader grant — intended "latest consent replaces earlier ones".
  - `low` `patch` grants.ts header claimed "each client shows at most one card", but pre-existing duplicate grants persist until the next re-authorization — reworded the comment to "afterwards only the new grant's card is shown".
  - `maybe-false` `reject` Fix ineffective if the connector re-registers via DCR with a new client_id — intent explicitly keys on the same clientId; if true it is the original low-severity clutter, so rejected (settle by observing whether the connector reuses its registration).
  - `false` `reject` removePortfolioAccess doc "Re-adding needs a new consent" outdated — still true; nothing it states is wrong.
  - `low` `reject` No test for code replay after re-authorization — replay path unchanged (old code row deleted by revokeGrant → invalid_grant); existing replay test covers the rule; unlikely, adds test surface only.
  - `false` `reject` Unfiltered findFirstOrThrow in existing tests fragile — those tests authorize each client once; only one grant row exists.
  - `low` `reject` Local `refresh` helper shadows a neighbouring test's helper — test-local scope, cosmetic.
  - `false` `reject` `if (rotated.ok)` hides failures — preceded by `expect(rotated).toMatchObject({ ok: true })`, which fails first.
  - `false` `reject` Per-grant revokeGrant loop inefficient — at most one older grant in normal use; reusing revokeGrant is what the decision asks.
  - `low` `reject` Spec metadata/Code Map incomplete — fix edits this build's spec.
  - `maybe-false` `reject` (edge) DCR re-registration leaves old registration's grant — duplicate of the DCR finding above; same reasoning.
  - `low` `reject` (edge) Two pending consents, older code exchanged last revokes the newer grant — needs two parallel consents within 10 min; fix adds a condition; user can reconnect.
  - `low` `reject` (edge) Doc says "latest consent" but order is by exchange — negligible wording nuance; exchange immediately follows consent in practice.
  - `maybe-false` `reject` (intent) "App" means clientId, not app as user sees it — duplicate of the DCR finding; intent fixes clientId.
  - `false` `reject` (intent) UI not exercised — ConnectedAppsList renders listConnectedApps one-to-one and the intent places tests in src/modules/mcp.
  - `false` `reject` (intent) Revocation at exchange, not consent — intent names exchangeCode explicitly.
  - `false` `reject` (intent) Parallel sessions of one registration lose the older one — intended by the decision.

## Verification

**Commands:**
- `npx vitest run src/modules/mcp` -- expected: all pass
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed

## Auto Run Result

Status: done

**Summary:** `exchangeCode` now revokes (via `revokeGrant`, same transaction, timestamp `issuedAt`) every other active grant of the same client after creating the new grant, so re-authorizing replaces the earlier consent and Settings › Verbundene Apps shows one card for that app.

**Files changed:**
- `src/modules/mcp/tokens.ts` -- revoke the client's older active grants in `exchangeCode`; doc comments updated.
- `src/modules/mcp/grants.ts` -- header comment notes that re-authorizing replaces the old card.
- `src/modules/mcp/oauth.test.ts` -- re-authorization test: old grant revoked and tokens deleted, old tokens refused, new pair works and rotates, failed exchange leaves grant, other client untouched.
- `src/modules/mcp/grants.test.ts` -- remove portfolio access, reconnect → exactly one card with the new grant.

**Review findings:** 18 findings; 1 patch applied (low: grants.ts comment wording); 0 deferred; 17 rejected (reasons in Review Triage Log: 9 false, 3 maybe-false duplicates of the DCR re-registration question that the intent settles by clientId, 5 low cosmetic/unlikely or spec-only).

**Follow-up review recommended:** false (patched: high 0, medium 0, low 1).

**Verification:** `npx vitest run src/modules/mcp` 184 passed; `npm run lint`, `npm run typecheck` clean; `npm test` 261 files / 3631 tests passed; `npm run build` succeeded (all with `DATABASE_URL` pointed at a scratch DB).

**Residual risks:** If a connector registers anew via DCR when reconnecting (new client_id), the old card still remains until disconnected manually. Grants duplicated before this change persist until the client re-authorizes.
