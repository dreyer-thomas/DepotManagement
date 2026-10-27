import { prisma } from "@/db";
import type { Prisma } from "@/db/generated/prisma/client";
import { isThreshold, parseTargets, PORTFOLIO_SCOPE, type Segment, type TargetFailureReason, type Targets, targetRecord, targetsFromRecord } from "@/core/rebalancing";
import { getDepot } from "@/modules/ledger";

/** Prisma client or interactive-transaction client. */
export type RebalancingDb = Prisma.TransactionClient;

/** Scope value of the whole Portfolio; any other scope is a Depot id. */
export const PORTFOLIO_TARGET_SCOPE = PORTFOLIO_SCOPE;

/** The stored targets of a scope: percent per segment (every segment, "0" when absent) and the threshold. */
export type TargetAllocation = { targets: Targets; threshold: string };

export type SetTargetAllocationFailureReason = "scope-not-found" | TargetFailureReason;

export type SetTargetAllocationResult =
  | { ok: true; allocation: TargetAllocation }
  | { ok: false; reason: SetTargetAllocationFailureReason; segment?: Segment };

function parseWeights(json: string): Targets | null {
  try {
    return targetsFromRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The stored target allocation of `scope` (`portfolio` or a Depot id); null when none (or unreadable). */
export async function getTargetAllocation(scope: string, db: RebalancingDb = prisma): Promise<TargetAllocation | null> {
  const row = await db.targetAllocation.findUnique({ where: { scope }, select: { weights: true, threshold: true } });
  if (!row) return null;
  const targets = parseWeights(row.weights);
  return targets && isThreshold(row.threshold) ? { targets, threshold: row.threshold } : null;
}

/**
 * Stores the targets (percent per segment as German or plain text; empty = 0) and the threshold (empty =
 * 2) of `scope`: `portfolio` or an existing Depot (`scope-not-found` otherwise). Everything is validated
 * (`parseTargets`) before the one upsert; the weights are stored as JSON of the non-zero segments.
 */
export async function setTargetAllocation(
  scope: unknown,
  targets: Readonly<Partial<Record<Segment, unknown>>>,
  threshold: unknown,
  db: RebalancingDb = prisma,
  now: () => Date = () => new Date(),
): Promise<SetTargetAllocationResult> {
  const validScope =
    scope === PORTFOLIO_TARGET_SCOPE || (typeof scope === "string" && scope !== "" && (await getDepot(scope, db)) !== null) ? (scope as string) : null;
  if (validScope === null) return { ok: false, reason: "scope-not-found" };
  const parsed = parseTargets(targets, threshold);
  if (!parsed.ok) return parsed.segment === undefined ? { ok: false, reason: parsed.reason } : { ok: false, reason: parsed.reason, segment: parsed.segment };
  const weights = JSON.stringify(targetRecord(parsed.targets));
  const updatedAt = now().toISOString();
  await db.targetAllocation.upsert({
    where: { scope: validScope },
    create: { scope: validScope, weights, threshold: parsed.threshold, updatedAt },
    update: { weights, threshold: parsed.threshold, updatedAt },
  });
  return { ok: true, allocation: { targets: parsed.targets, threshold: parsed.threshold } };
}
