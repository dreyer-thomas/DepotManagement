/**
 * Parqet migration preview (story 2.3): reads one export for a target Depot and returns what booking it
 * would produce. Read-only: it never writes Securities, Transactions or CorporateActions (AD-4, AD-16);
 * the figures come from the file's proposals alone, computed by core (AD-1, AD-10).
 */
import { prisma } from "@/db";
import { cashBalance } from "@/core/cash";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { computePositions } from "@/core/positions";
import { type AssetType, getDepot, type LedgerDb, listSecurities } from "@/modules/ledger";
import {
  type FlaggedRow,
  type IsinChangeProposal,
  PROPOSAL_TYPES,
  type ProposalType,
  readParqetCsv,
} from "./parqet-reader";

export type PreviewSecurity = {
  key: string;
  isin: string | null;
  cryptoSymbol: string | null;
  /** The stored name for an existing Security, else the name from the file. */
  name: string;
  /** The stored type for an existing Security, else the proposed one. */
  assetType: AssetType;
  /** True when the ISIN / crypto symbol is already in the ledger. */
  existing: boolean;
};

export type PreviewPosition = { securityKey: string; name: string; quantity: string; costBasis: string };

export type PreviewFigures = {
  positions: PreviewPosition[];
  /** Sum of the open Positions' Cost Basis. */
  investedCapital: string;
  cashBalance: string;
};

export type ParqetPreview = {
  depot: { id: string; name: string };
  /** `null` when the file has no datable row; then there are no figures. */
  exportDate: string | null;
  counts: Record<ProposalType, number>;
  /** Proposals whose amount (or tax) was aligned to the cash row. */
  adjustedCount: number;
  isinChanges: IsinChangeProposal[];
  flagged: FlaggedRow[];
  securities: PreviewSecurity[];
  figures: PreviewFigures | null;
};

export type PreviewFailureReason = "depot-not-found" | "depot-archived" | "empty-file" | "missing-columns";

export type PreviewResult =
  | { ok: true; preview: ParqetPreview }
  | { ok: false; reason: Exclude<PreviewFailureReason, "missing-columns"> }
  | { ok: false; reason: "missing-columns"; columns: string[] };

export async function previewParqetMigration(depotId: string, text: string, db: LedgerDb = prisma): Promise<PreviewResult> {
  const depot = await getDepot(depotId, db);
  if (!depot) return { ok: false, reason: "depot-not-found" };
  if (depot.archived) return { ok: false, reason: "depot-archived" };

  const read = readParqetCsv(text);
  if (!read.ok) return read;

  const stored = await listSecurities(db);
  const byKey = new Map<string, (typeof stored)[number]>();
  for (const security of stored) {
    if (security.isin) byKey.set(security.isin, security);
    if (security.cryptoSymbol) byKey.set(security.cryptoSymbol, security);
  }
  const securities: PreviewSecurity[] = read.securities
    .map((security) => {
      const existing = byKey.get(security.key);
      return {
        key: security.key,
        isin: security.isin,
        cryptoSymbol: security.cryptoSymbol,
        name: existing?.name ?? security.name,
        assetType: existing?.assetType ?? security.proposedAssetType,
        existing: existing !== undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE") || (a.key < b.key ? -1 : 1));
  const nameOf = new Map(securities.map((security) => [security.key, security.name]));

  const counts = Object.fromEntries(PROPOSAL_TYPES.map((type) => [type, 0])) as Record<ProposalType, number>;
  for (const proposal of read.proposals) counts[proposal.type] += 1;
  const adjustedCount = read.proposals.filter(
    (proposal) => proposal.originalAmount !== undefined || proposal.originalTax !== undefined,
  ).length;

  let figures: PreviewFigures | null = null;
  if (read.exportDate) {
    const rows = read.proposals.map((proposal) => ({ ...proposal, securityId: proposal.securityKey }));
    const isinChanges = read.isinChanges.map((change) => ({
      oldSecurityId: change.oldKey,
      newSecurityId: change.newKey,
      date: change.date,
      oldQuantity: change.oldQuantity,
      newQuantity: change.newQuantity,
    }));
    const positions = computePositions(rows, [], read.exportDate, { splits: [], isinChanges })
      .map((position) => ({
        securityKey: position.securityId,
        name: nameOf.get(position.securityId) ?? position.securityId,
        quantity: position.quantity,
        costBasis: position.costBasis,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-DE") || (a.securityKey < b.securityKey ? -1 : 1));
    const investedCapital = positions.reduce((sum, position) => sum.plus(position.costBasis), new ExactDecimal(0));
    figures = {
      positions,
      investedCapital: canonicalDecimal(investedCapital),
      cashBalance: cashBalance(read.proposals, read.exportDate),
    };
  }

  return {
    ok: true,
    preview: {
      depot: { id: depot.id, name: depot.name },
      exportDate: read.exportDate,
      counts,
      adjustedCount,
      isinChanges: read.isinChanges,
      flagged: read.flagged,
      securities,
      figures,
    },
  };
}
