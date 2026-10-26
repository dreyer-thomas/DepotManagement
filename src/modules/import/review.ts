// Review rules of an import batch (story 5.3): duplicate classification of every proposal against the
// Depot's ledger and the rest of the batch (AD-15 via `core/duplicates`), the effective decision per
// proposal and the batch counts. Pure: no Prisma, no I/O; the shell loads the inputs.
import type { IsinChange } from "@/core/corporate-actions";
import { type DuplicateCandidate, matchDuplicates } from "@/core/duplicates";
import type { TransactionProposal } from "./proposal";

/** A stored review decision of one proposal; `null` = none yet. */
export type ReviewDecision = "book" | "discard";

/** Duplicate status of a proposal: `unique`, `duplicate` (one ledger match), `ambiguous` (needs a decision). */
export type ProposalReviewStatus = "unique" | "duplicate" | "ambiguous";

/** What happens to a proposal on "Buchen": booked, not booked, or not yet decided (blocks booking). */
export type EffectiveDecision = "book" | "discard" | "open";

/** File status shown by the chip: erkannt, mehrdeutig, Duplikat, keine Buchung, fehlgeschlagen. */
export type ItemReviewStatus = "PARSED" | "AMBIGUOUS" | "DUPLICATE" | "NO_BOOKING" | "FAILED";

/** Stored status of a file (Prisma `ImportItemStatus`). */
export type StoredItemStatus = "PARSED" | "FAILED" | "NO_BOOKING";

/** A ledger row of the Depot as `core/duplicates` compares it (`securityId` of the stored Security). */
export type ReviewLedgerRow = DuplicateCandidate & { id: string };

/** One file of the batch: FAILED and NO_BOOKING items have no proposals. */
export type ReviewItemInput = { id: string; status: StoredItemStatus; proposals: readonly TransactionProposal[] };

export type ProposalClassification<T> = {
  status: ProposalReviewStatus;
  /** Ledger rows the proposal may repeat. */
  ledgerMatches: T[];
  /** Another proposal of the same batch is the same booking. */
  siblingMatch: boolean;
};

/** Stable key of a proposal within its batch: `"<itemId>:<index>"`. */
export function proposalKey(itemId: string, index: number): string {
  return `${itemId}:${index}`;
}

/** The Security id a proposal is matched with: the stored Security of its ISIN, else a pseudo key matching no ledger row. */
export function candidateSecurityId(isin: string | undefined, securityIdByIsin: ReadonlyMap<string, string>): string | null {
  if (isin === undefined) return null;
  return securityIdByIsin.get(isin) ?? `isin:${isin}`;
}

function candidate(
  depotId: string,
  key: string,
  proposal: TransactionProposal,
  securityIdByIsin: ReadonlyMap<string, string>,
): DuplicateCandidate & { id: string } {
  return {
    id: key,
    depotId,
    date: proposal.date,
    type: proposal.type,
    securityId: candidateSecurityId(proposal.isin, securityIdByIsin),
    quantity: proposal.quantity ?? null,
    amount: proposal.amount,
    fee: proposal.fee,
    tax: proposal.tax,
  };
}

/**
 * Classifies every proposal of `items` (per item, aligned with its proposals): ledger matches come from
 * `matchDuplicates` against `ledgerRows` (ISINs resolved through `isinChanges`), sibling matches from
 * `matchDuplicates` against every other proposal of the batch. Any sibling match or two or more ledger
 * matches → `ambiguous`; exactly one ledger match → `duplicate`; else `unique`.
 */
export function classifyBatch<T extends ReviewLedgerRow>(
  depotId: string,
  items: readonly ReviewItemInput[],
  ledgerRows: readonly T[],
  securityIdByIsin: ReadonlyMap<string, string>,
  isinChanges: readonly IsinChange[],
): ProposalClassification<T>[][] {
  // Only rows of the same date and type can match: index them once.
  const byDateType = new Map<string, T[]>();
  for (const row of ledgerRows) {
    const index = `${row.date}|${row.type}`;
    const list = byDateType.get(index);
    if (list) list.push(row);
    else byDateType.set(index, [row]);
  }
  const candidates = items.map((item) =>
    item.status === "PARSED"
      ? item.proposals.map((proposal, index) => candidate(depotId, proposalKey(item.id, index), proposal, securityIdByIsin))
      : [],
  );
  const siblingsByDateType = new Map<string, (DuplicateCandidate & { id: string })[]>();
  for (const own of candidates.flat()) {
    const index = `${own.date}|${own.type}`;
    const list = siblingsByDateType.get(index);
    if (list) list.push(own);
    else siblingsByDateType.set(index, [own]);
  }
  return candidates.map((list) =>
    list.map((own) => {
      const index = `${own.date}|${own.type}`;
      const ledgerMatches = matchDuplicates(own, byDateType.get(index) ?? [], isinChanges).matches;
      const siblingMatch = matchDuplicates(own, siblingsByDateType.get(index) ?? [], isinChanges).matches.length > 0;
      const status: ProposalReviewStatus =
        siblingMatch || ledgerMatches.length >= 2 ? "ambiguous" : ledgerMatches.length === 1 ? "duplicate" : "unique";
      return { status, ledgerMatches, siblingMatch };
    }),
  );
}

/** `unique` → the stored decision, default book; `duplicate` → never booked; `ambiguous` → the stored decision, else open. */
export function effectiveDecision(status: ProposalReviewStatus, stored: ReviewDecision | null): EffectiveDecision {
  if (status === "duplicate") return "discard";
  if (status === "unique") return stored ?? "book";
  return stored ?? "open";
}

/**
 * The chip of a file: FAILED; NO_BOOKING; a PARSED file without proposals → FAILED; any ambiguous
 * proposal → AMBIGUOUS; all duplicate → DUPLICATE; else PARSED.
 */
export function itemReviewStatus(status: StoredItemStatus, proposals: readonly ProposalReviewStatus[]): ItemReviewStatus {
  if (status === "FAILED") return "FAILED";
  if (status === "NO_BOOKING") return "NO_BOOKING";
  if (proposals.length === 0) return "FAILED";
  if (proposals.includes("ambiguous")) return "AMBIGUOUS";
  if (proposals.every((proposal) => proposal === "duplicate")) return "DUPLICATE";
  return "PARSED";
}

export type ReviewCounts = {
  fileCount: number;
  /** Files per chip. */
  files: Record<ItemReviewStatus, number>;
  /** Ambiguous proposals without a decision. */
  openDecisions: number;
  /** Keys of the proposals "Buchen" books, in batch order. */
  bookKeys: string[];
};

/** Counts of a reviewed batch. */
export function reviewCounts(
  items: readonly { reviewStatus: ItemReviewStatus; proposals: readonly { key: string; effective: EffectiveDecision }[] }[],
): ReviewCounts {
  const files: Record<ItemReviewStatus, number> = { PARSED: 0, AMBIGUOUS: 0, DUPLICATE: 0, NO_BOOKING: 0, FAILED: 0 };
  let openDecisions = 0;
  const bookKeys: string[] = [];
  for (const item of items) {
    files[item.reviewStatus] += 1;
    for (const proposal of item.proposals) {
      if (proposal.effective === "open") openDecisions += 1;
      if (proposal.effective === "book") bookKeys.push(proposal.key);
    }
  }
  return { fileCount: items.length, files, openDecisions, bookKeys };
}

/** A stored decisions JSON aligned to `length` proposals; anything unreadable counts as no decision. */
export function readDecisions(json: string, length: number): (ReviewDecision | null)[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = null;
  }
  const list = Array.isArray(parsed) ? parsed : [];
  return Array.from({ length }, (_, index) => {
    const value: unknown = list[index];
    return value === "book" || value === "discard" ? value : null;
  });
}
