/**
 * Parqet migration preview (story 2.3) and the analysis shared with confirmation (story 2.4): reads one
 * export for a target Depot and returns what booking it would produce. Read-only: it never writes
 * Securities, Transactions or CorporateActions (AD-4, AD-16); the figures come from the file's proposals
 * alone, computed by core (AD-1, AD-10). Duplicates are matched against the Depot's existing ledger only
 * (AD-15), never within the file.
 */
import { prisma } from "@/db";
import { cashBalance } from "@/core/cash";
import type { IsinChange, Split } from "@/core/corporate-actions";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { matchDuplicates } from "@/core/duplicates";
import { computePositions } from "@/core/positions";
import {
  type AssetType,
  getDepot,
  type LedgerDb,
  listIsinChanges,
  listSecurities,
  listSplits,
  listTransactions,
  type SecuritySummary,
  type TransactionRecord,
} from "@/modules/ledger";
import { itemKey } from "./decisions";
import {
  type FlaggedRow,
  type IsinChangeProposal,
  PROPOSAL_TYPES,
  type ParqetReadResult,
  type ProposalType,
  readParqetCsv,
  type SplitProposal,
  type TransactionProposal,
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
  /** True for a new ISIN Security: its type is the name classifier's estimate (overridable). */
  estimated: boolean;
};

export type PreviewPosition = { securityKey: string; name: string; quantity: string; costBasis: string };

export type PreviewFigures = {
  positions: PreviewPosition[];
  /** Sum of the open Positions' Cost Basis. */
  investedCapital: string;
  cashBalance: string;
};

/** A proposal that may repeat rows already in the target Depot (`duplicate`: one match, `ambiguous`: more). */
export type PreviewDuplicate = {
  /** `itemKey` of the proposal (its records joined by "-"). */
  key: string;
  proposal: TransactionProposal;
  status: "duplicate" | "ambiguous";
  matches: TransactionRecord[];
};

/** A detected ISIN change; `recorded` when its old Security already has an ISIN change on that date. */
export type PreviewIsinChange = IsinChangeProposal & { recorded: boolean };

/** A detected split; `recorded` when its Security already has a split of the same ratio on that date. */
export type PreviewSplit = SplitProposal & { recorded: boolean };

export type ParqetPreview = {
  depot: { id: string; name: string };
  /** `null` when the file has no datable row; then there are no figures. */
  exportDate: string | null;
  counts: Record<ProposalType, number>;
  /** Proposals whose amount (or tax) was aligned to the cash row. */
  adjustedCount: number;
  splits: PreviewSplit[];
  isinChanges: PreviewIsinChange[];
  /** The BUY halves of deliveries (unpaired Security `TransferIn`), in proposal order. */
  deliveries: TransactionProposal[];
  flagged: FlaggedRow[];
  securities: PreviewSecurity[];
  /** Proposals matching existing rows of the target Depot, in proposal order. */
  duplicates: PreviewDuplicate[];
  /** False when the file has no Cash Account rows (cash cannot be reconciled; funding DEPOSITs are added). */
  hasCashRows: boolean;
  /** Number of funding DEPOSITs added for a file without Cash rows (0 with Cash rows). */
  fundingCount: number;
  /** Number of standalone TAX proposals booking a difference between trades and Cash rows (> €0.01). */
  cashDifferenceCount: number;
  /** Canonical Σ tax of those TAX proposals; "0" without any. */
  cashDifferenceTotal: string;
  /** Number of SELLs clamped to the held quantity (rounding oversell ≤ 0.001). */
  roundingCount: number;
  figures: PreviewFigures | null;
};

export type PreviewFailureReason = "depot-not-found" | "depot-archived" | "empty-file" | "missing-columns";

export type PreviewFailure =
  | { ok: false; reason: Exclude<PreviewFailureReason, "missing-columns"> }
  | { ok: false; reason: "missing-columns"; columns: string[] };

export type PreviewResult = { ok: true; preview: ParqetPreview } | PreviewFailure;

/** The preview plus what confirmation needs from the same read (never sent to the client). */
export type ParqetAnalysis = {
  read: Extract<ParqetReadResult, { ok: true }>;
  preview: ParqetPreview;
  /** Stored Securities by ISIN / crypto symbol. */
  stored: Map<string, SecuritySummary>;
};

/** Ledger rows with the Security id `core/duplicates` compares. */
type Candidate = TransactionRecord & { securityId: string | null };

function duplicatesOf(
  depotId: string,
  proposals: readonly TransactionProposal[],
  ledger: readonly TransactionRecord[],
  stored: Map<string, SecuritySummary>,
  isinChanges: readonly IsinChange[],
): PreviewDuplicate[] {
  // Only rows of the same date and type can match: index them once.
  const byDateType = new Map<string, Candidate[]>();
  for (const row of ledger) {
    const index = `${row.date}|${row.type}`;
    const candidate: Candidate = { ...row, securityId: row.security?.id ?? null };
    const list = byDateType.get(index);
    if (list) list.push(candidate);
    else byDateType.set(index, [candidate]);
  }
  const duplicates: PreviewDuplicate[] = [];
  for (const proposal of proposals) {
    const rows = byDateType.get(`${proposal.date}|${proposal.type}`);
    if (!rows) continue;
    let securityId: string | null = null;
    if (proposal.securityKey !== null) {
      const security = stored.get(proposal.securityKey);
      // A Security not yet in the ledger has no rows: unique.
      if (!security) continue;
      securityId = security.id;
    }
    const result = matchDuplicates({ depotId, ...proposal, securityId }, rows, isinChanges);
    if (result.status === "unique") continue;
    duplicates.push({
      key: itemKey(proposal),
      proposal,
      status: result.status,
      matches: result.matches.map((match) => {
        const record: Partial<Candidate> = { ...match };
        delete record.securityId;
        return record as TransactionRecord;
      }),
    });
  }
  return duplicates;
}

/**
 * Reads `text` for Depot `depotId` against the current ledger: Depot check, Security annotation,
 * duplicates of the Depot's rows, recorded splits and ISIN changes and the file's figures. Read-only.
 */
export async function analyzeParqetExport(
  depotId: string,
  text: string,
  db: LedgerDb = prisma,
): Promise<{ ok: true; analysis: ParqetAnalysis } | PreviewFailure> {
  const depot = await getDepot(depotId, db);
  if (!depot) return { ok: false, reason: "depot-not-found" };
  if (depot.archived) return { ok: false, reason: "depot-archived" };

  const read = readParqetCsv(text);
  if (!read.ok) return read;

  const stored = new Map<string, SecuritySummary>();
  for (const security of await listSecurities(db)) {
    if (security.isin) stored.set(security.isin, security);
    if (security.cryptoSymbol) stored.set(security.cryptoSymbol, security);
  }
  const securities: PreviewSecurity[] = read.securities
    .map((security) => {
      const existing = stored.get(security.key);
      return {
        key: security.key,
        isin: security.isin,
        cryptoSymbol: security.cryptoSymbol,
        name: existing?.name ?? security.name,
        assetType: existing?.assetType ?? security.proposedAssetType,
        existing: existing !== undefined,
        estimated: existing === undefined && security.cryptoSymbol === null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE") || (a.key < b.key ? -1 : 1));
  const nameOf = new Map(securities.map((security) => [security.key, security.name]));

  const counts = Object.fromEntries(PROPOSAL_TYPES.map((type) => [type, 0])) as Record<ProposalType, number>;
  for (const proposal of read.proposals) counts[proposal.type] += 1;
  const adjustedCount = read.proposals.filter(
    (proposal) => proposal.originalAmount !== undefined || proposal.originalTax !== undefined,
  ).length;

  const cashDifferences = read.proposals.filter((proposal) => proposal.cashDifference);

  const recordedChanges = await listIsinChanges(db);
  const coreChanges: IsinChange[] = recordedChanges.map((change) => ({
    oldSecurityId: change.oldSecurity.id,
    newSecurityId: change.newSecurity.id,
    date: change.date,
    oldQuantity: change.oldQuantity,
    newQuantity: change.newQuantity,
  }));
  const isinChanges: PreviewIsinChange[] = read.isinChanges.map((change) => {
    const old = stored.get(change.oldKey);
    const recorded = old !== undefined && recordedChanges.some((r) => r.oldSecurity.id === old.id && r.date === change.date);
    return { ...change, recorded };
  });

  const recordedSplits = await listSplits(db);
  const splits: PreviewSplit[] = read.splits.map((split) => {
    const security = stored.get(split.key);
    const recorded =
      security !== undefined &&
      recordedSplits.some(
        (r) =>
          r.security.id === security.id &&
          r.date === split.date &&
          r.ratioOld === split.ratioOld &&
          r.ratioNew === split.ratioNew,
      );
    return { ...split, recorded };
  });

  const duplicates = duplicatesOf(depot.id, read.proposals, await listTransactions(depot.id, db), stored, coreChanges);

  let figures: PreviewFigures | null = null;
  if (read.exportDate) {
    const rows = read.proposals.map((proposal) => ({ ...proposal, securityId: proposal.securityKey }));
    const fileChanges = read.isinChanges.map((change) => ({
      oldSecurityId: change.oldKey,
      newSecurityId: change.newKey,
      date: change.date,
      oldQuantity: change.oldQuantity,
      newQuantity: change.newQuantity,
    }));
    const fileSplits: Split[] = read.splits.map((split) => ({
      securityId: split.key,
      date: split.date,
      ratioOld: split.ratioOld,
      ratioNew: split.ratioNew,
    }));
    const positions = computePositions(rows, [], read.exportDate, { splits: fileSplits, isinChanges: fileChanges })
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
    analysis: {
      read,
      stored,
      preview: {
        depot: { id: depot.id, name: depot.name },
        exportDate: read.exportDate,
        counts,
        adjustedCount,
        splits,
        isinChanges,
        deliveries: read.proposals.filter((proposal) => proposal.delivery === "buy"),
        flagged: read.flagged,
        securities,
        duplicates,
        hasCashRows: read.hasCashRows,
        fundingCount: read.proposals.filter((proposal) => proposal.funding).length,
        cashDifferenceCount: cashDifferences.length,
        cashDifferenceTotal: canonicalDecimal(
          cashDifferences.reduce((sum, proposal) => sum.plus(proposal.tax), new ExactDecimal(0)),
        ),
        roundingCount: read.proposals.filter((proposal) => proposal.type === "SELL" && proposal.originalQuantity !== undefined)
          .length,
        figures,
      },
    },
  };
}

export async function previewParqetMigration(depotId: string, text: string, db: LedgerDb = prisma): Promise<PreviewResult> {
  const result = await analyzeParqetExport(depotId, text, db);
  return result.ok ? { ok: true, preview: result.analysis.preview } : result;
}
