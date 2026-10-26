// Batch-level merge of the parse outcomes of ONE upload (story 5.4), pure and broker-independent: a
// comdirect dividend Steuermitteilung (`dividend-tax-notice` link) is merged into every Ertragsgutschrift
// (`dividend-credit` link) of the same Referenz-Nummer, so review and booking see an ordinary DIVIDEND.
// Links are consumed here and never stored; merging never crosses uploads.
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import type { DocumentLink, TransactionProposal } from "../proposal";
import { linkMismatchReason, NOTICE_WITHOUT_CREDIT_REASON, noticeMergedInfo } from "./comdirect/reasons";
import type { ParseOutcome } from "./registry";

/** What an item stores: proposals (with an optional review note), a failure, or a document needing no booking. */
export type LinkedOutcome =
  | { status: "PARSED"; documentType: string; proposals: TransactionProposal[]; note?: string }
  | { status: "NO_BOOKING"; documentType: string; reason: string }
  | { status: "FAILED"; reason: string };

/** One file of an upload: its display name and parse outcome. */
export type LinkInput = { fileName: string; outcome: ParseOutcome };

type Credit = Extract<DocumentLink, { kind: "dividend-credit" }>;
type Notice = Extract<DocumentLink, { kind: "dividend-tax-notice" }>;

function sameDecimal(a: string, b: string): boolean {
  return new ExactDecimal(a).equals(b);
}

/**
 * Merges notices into credits, aligned with `inputs`. Per reference: every notice and every credit must
 * agree (ISIN, amount before tax; notices also on the amount after tax), else all of them fail. A merged
 * credit gets `tax = amount − afterTax` and loses its note; the notice becomes NO_BOOKING. A notice
 * without credit fails; a credit without notice keeps its note.
 */
export function linkDocuments(inputs: readonly LinkInput[]): LinkedOutcome[] {
  const credits = new Map<string, number[]>();
  const notices = new Map<string, number[]>();
  for (const [index, { outcome }] of inputs.entries()) {
    if (outcome.status === "PARSED" && outcome.link?.kind === "dividend-credit") {
      credits.set(outcome.link.reference, [...(credits.get(outcome.link.reference) ?? []), index]);
    }
    if (outcome.status === "LINK_ONLY" && outcome.link.kind === "dividend-tax-notice") {
      notices.set(outcome.link.reference, [...(notices.get(outcome.link.reference) ?? []), index]);
    }
  }

  const result: LinkedOutcome[] = inputs.map(({ outcome }): LinkedOutcome => {
    if (outcome.status === "FAILED") return outcome;
    if (outcome.status === "LINK_ONLY") return { status: "FAILED", reason: NOTICE_WITHOUT_CREDIT_REASON };
    return {
      status: "PARSED",
      documentType: outcome.documentType,
      proposals: outcome.proposals,
      ...(outcome.note !== undefined ? { note: outcome.note } : {}),
    };
  });

  for (const [reference, noticeIndexes] of notices) {
    const creditIndexes = credits.get(reference) ?? [];
    if (creditIndexes.length === 0) continue; // stays FAILED: notice without credit
    const linkOf = (index: number) => (inputs[index].outcome as { link: DocumentLink }).link;
    const noticeLinks = noticeIndexes.map((index) => linkOf(index) as Notice);
    const [notice] = noticeLinks;
    const noticesAgree = noticeLinks.every(
      (other) => other.isin === notice.isin && sameDecimal(other.beforeTax, notice.beforeTax) && sameDecimal(other.afterTax, notice.afterTax),
    );
    const creditsAgree = creditIndexes.every((index) => {
      const outcome = result[index] as Extract<LinkedOutcome, { status: "PARSED" }>;
      const credit = linkOf(index) as Credit;
      return outcome.proposals.every((proposal) => proposal.isin === notice.isin) && sameDecimal(credit.beforeTax, notice.beforeTax);
    });
    if (!noticesAgree || !creditsAgree) {
      const failure: LinkedOutcome = { status: "FAILED", reason: linkMismatchReason(reference) };
      for (const index of [...creditIndexes, ...noticeIndexes]) result[index] = failure;
      continue;
    }
    for (const index of creditIndexes) {
      const outcome = result[index] as Extract<LinkedOutcome, { status: "PARSED" }>;
      result[index] = {
        status: "PARSED",
        documentType: outcome.documentType,
        proposals: outcome.proposals.map((proposal) =>
          proposal.type === "DIVIDEND"
            ? { ...proposal, tax: canonicalDecimal(new ExactDecimal(proposal.amount).minus(notice.afterTax)) }
            : proposal,
        ),
      };
    }
    const info = noticeMergedInfo(creditIndexes.map((index) => inputs[index].fileName));
    for (const index of noticeIndexes) {
      const outcome = inputs[index].outcome as Extract<ParseOutcome, { status: "LINK_ONLY" }>;
      result[index] = { status: "NO_BOOKING", documentType: outcome.documentType, reason: info };
    }
  }
  return result;
}
