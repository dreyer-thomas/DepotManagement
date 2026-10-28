// Connected apps (story 9.5): the non-revoked grants listed in Settings › Verbundene Apps, and disconnecting
// them. Disconnecting uses `revokeGrant` (sets `revokedAt`, deletes every code and token of the grant), so the
// next MCP call with an old access token gets 401 and its refresh token `invalid_grant`. No token values leave
// this module.
import { prisma } from "@/db";
import { type McpDb, parseJsonArray } from "./clients";
import { PORTFOLIO_READ_SCOPE } from "./authorize";
import { inTransaction, revokeGrant } from "./tokens";

/** One active connection as shown in Settings. Timestamps are UTC ISO instants. */
export type ConnectedApp = {
  grantId: string;
  clientName: string;
  /** Distinct `host` (hostname plus port, if any) of the client's registered redirect URIs. */
  redirectHosts: string[];
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type DisconnectAppResult = { ok: true; clientName: string } | { ok: false; reason: "not-found" };

export type DisconnectAllAppsResult = { ok: true; count: number };

export type RemovePortfolioAccessResult = { ok: true; clientName: string } | { ok: false; reason: "not-found" };

const GRANT_ID_MAX_LENGTH = 200;

/** Distinct hosts of the redirect URIs, in registration order; unparsable URIs are skipped. */
export function redirectHosts(redirectUris: readonly string[]): string[] {
  const hosts: string[] = [];
  for (const uri of redirectUris) {
    let host: string;
    try {
      host = new URL(uri).host;
    } catch {
      continue;
    }
    if (host !== "" && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** Every grant with `revokedAt = null`, newest `createdAt` first. */
export async function listConnectedApps(db: McpDb = prisma): Promise<ConnectedApp[]> {
  const grants = await db.oAuthGrant.findMany({
    where: { revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      scope: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { clientName: true, redirectUris: true } },
    },
  });
  return grants.map((grant) => ({
    grantId: grant.id,
    clientName: grant.client.clientName,
    redirectHosts: redirectHosts(parseJsonArray(grant.client.redirectUris)),
    scopes: grant.scope.split(" ").filter(Boolean),
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt,
  }));
}

/** "Trennen": revokes one active grant. An unknown or already revoked id is `not-found` and writes nothing. */
export async function disconnectApp(
  grantId: unknown,
  db: McpDb = prisma,
  now: () => Date = () => new Date(),
): Promise<DisconnectAppResult> {
  if (typeof grantId !== "string" || grantId === "" || grantId.length > GRANT_ID_MAX_LENGTH) return { ok: false, reason: "not-found" };
  return inTransaction(db, async (tx): Promise<DisconnectAppResult> => {
    const grant = await tx.oAuthGrant.findFirst({
      where: { id: grantId, revokedAt: null },
      select: { id: true, client: { select: { clientName: true } } },
    });
    if (!grant) return { ok: false, reason: "not-found" };
    await revokeGrant(grant.id, tx, now);
    return { ok: true, clientName: grant.client.clientName };
  });
}

function withoutPortfolioRead(scope: string): string {
  return scope
    .split(" ")
    .filter((name) => name !== "" && name !== PORTFOLIO_READ_SCOPE)
    .join(" ");
}

/**
 * "Depotzugriff entfernen" (story 10.1): strips `portfolio:read` from one active grant and from its token rows,
 * in one transaction; the grant stays connected. Idempotent when the scope is already absent (no write). An
 * unknown, revoked or malformed id is `not-found` and writes nothing. Re-adding needs a new consent.
 */
export async function removePortfolioAccess(grantId: unknown, db: McpDb = prisma): Promise<RemovePortfolioAccessResult> {
  if (typeof grantId !== "string" || grantId === "" || grantId.length > GRANT_ID_MAX_LENGTH) return { ok: false, reason: "not-found" };
  return inTransaction(db, async (tx): Promise<RemovePortfolioAccessResult> => {
    const grant = await tx.oAuthGrant.findFirst({
      where: { id: grantId, revokedAt: null },
      select: { id: true, scope: true, client: { select: { clientName: true } } },
    });
    if (!grant) return { ok: false, reason: "not-found" };
    if (grant.scope.split(" ").includes(PORTFOLIO_READ_SCOPE)) {
      await tx.oAuthGrant.update({ where: { id: grant.id }, data: { scope: withoutPortfolioRead(grant.scope) } });
      const tokens = await tx.oAuthToken.findMany({ where: { grantId: grant.id }, select: { id: true, scope: true } });
      for (const token of tokens) {
        if (token.scope.split(" ").includes(PORTFOLIO_READ_SCOPE)) {
          await tx.oAuthToken.update({ where: { id: token.id }, data: { scope: withoutPortfolioRead(token.scope) } });
        }
      }
    }
    return { ok: true, clientName: grant.client.clientName };
  });
}

/** "Alle trennen": revokes every active grant in one transaction. */
export async function disconnectAllApps(db: McpDb = prisma, now: () => Date = () => new Date()): Promise<DisconnectAllAppsResult> {
  return inTransaction(db, async (tx): Promise<DisconnectAllAppsResult> => {
    const grants = await tx.oAuthGrant.findMany({ where: { revokedAt: null }, select: { id: true } });
    const at = now();
    for (const grant of grants) await revokeGrant(grant.id, tx, () => at);
    return { ok: true, count: grants.length };
  });
}
