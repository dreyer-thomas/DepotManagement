import type {
  BookImportBatchActionState,
  DecideProposalActionState,
  DiscardImportBatchActionState,
  UpdateProposalActionState,
  UploadDocumentsActionState,
} from "@/app/_actions/import";
import { type IsinChangeErrorReason, isinChangeErrorMessage } from "@/app/_components/corporate-actions/labels";
import { failureDetail, transactionErrorMessage, type TransactionErrorReason, transactionTypeLabel } from "@/app/_components/transactions/labels";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type {
  EditableProposalField,
  IsinChangeProposal,
  IsinChangeReviewStatus,
  ItemReviewStatus,
  ProposalReviewView,
  ProposalType,
} from "@/modules/import";
import type { TransactionRecord } from "@/modules/ledger";

/** Status chip text per file review status. */
export const ITEM_STATUS_LABELS: Record<ItemReviewStatus, string> = {
  PARSED: "erkannt",
  AMBIGUOUS: "mehrdeutig",
  DUPLICATE: "Duplikat",
  NO_BOOKING: "keine Buchung",
  CORPORATE_ACTION: "Kapitalmaßnahme",
  FAILED: "fehlgeschlagen",
};

/** Warning on an item whose file bytes were uploaded before. */
export const REUPLOAD_WARNING = "Diese Datei wurde bereits hochgeladen.";

export const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";

export type UploadErrorReason = Extract<NonNullable<UploadDocumentsActionState>, { ok: false }>["reason"] | "action-failed";
export type DiscardErrorReason = Extract<NonNullable<DiscardImportBatchActionState>, { ok: false }>["reason"] | "action-failed";

const UPLOAD_ERROR_MESSAGES: Record<UploadErrorReason, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "files-missing": "Bitte mindestens eine PDF-Datei auswählen.",
  "too-many-files": "Höchstens 50 Dateien auf einmal.",
  "upload-too-large": "Zusammen höchstens 20 MB. Bitte weniger Dateien auf einmal hochladen.",
  "depot-not-found": "Depot nicht gefunden.",
  "depot-archived": "Depot ist archiviert. Bitte zuerst reaktivieren.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a rejected upload. */
export function uploadErrorMessage(reason: UploadErrorReason): string {
  return UPLOAD_ERROR_MESSAGES[reason];
}

const DISCARD_ERROR_MESSAGES: Record<DiscardErrorReason, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "not-found": "Import nicht gefunden.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a failed discard. */
export function discardErrorMessage(reason: DiscardErrorReason): string {
  return DISCARD_ERROR_MESSAGES[reason];
}

/** "1 Datei" / "N Dateien". */
export function fileCountLabel(count: number): string {
  return count === 1 ? "1 Datei" : `${count} Dateien`;
}

/** Summary line of a batch: "N Dateien · X erkannt[ · Z ohne Buchung] · Y fehlgeschlagen". */
export function batchSummary(counts: { fileCount: number; parsedCount: number; failedCount: number }): string {
  const noBooking = counts.fileCount - counts.parsedCount - counts.failedCount;
  const noBookingPart = noBooking > 0 ? ` · ${noBooking} ohne Buchung` : "";
  return `${fileCountLabel(counts.fileCount)} · ${counts.parsedCount} erkannt${noBookingPart} · ${counts.failedCount} fehlgeschlagen`;
}

/** Megabytes with one decimal, German formatting (for the selection summary); below 0,1 MB "< 0,1 MB". */
export function formatMegabytes(bytes: number): string {
  if (bytes > 0 && bytes < 0.05 * 1024 * 1024) return "< 0,1 MB";
  return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/**
 * Review summary: "14 Dateien: 11 erkannt, 1 mehrdeutig, 1 Duplikat, 1 ohne Buchung, 1 Kapitalmaßnahme, 1 fehlgeschlagen
 * · 1 Entscheidung offen"; zero counts are left out except erkannt.
 */
export function reviewSummary(fileCount: number, files: Record<ItemReviewStatus, number>, openDecisions: number): string {
  const parts = [`${files.PARSED} erkannt`];
  if (files.AMBIGUOUS > 0) parts.push(`${files.AMBIGUOUS} mehrdeutig`);
  if (files.DUPLICATE > 0) parts.push(files.DUPLICATE === 1 ? "1 Duplikat" : `${files.DUPLICATE} Duplikate`);
  if (files.NO_BOOKING > 0) parts.push(`${files.NO_BOOKING} ohne Buchung`);
  if (files.CORPORATE_ACTION > 0) {
    parts.push(files.CORPORATE_ACTION === 1 ? "1 Kapitalmaßnahme" : `${files.CORPORATE_ACTION} Kapitalmaßnahmen`);
  }
  if (files.FAILED > 0) parts.push(`${files.FAILED} fehlgeschlagen`);
  const summary = `${fileCountLabel(fileCount)}: ${parts.join(", ")}`;
  return openDecisions > 0 ? `${summary} · ${openDecisionsLabel(openDecisions)}` : summary;
}

/** "1 Entscheidung offen" / "N Entscheidungen offen". */
export function openDecisionsLabel(count: number): string {
  return count === 1 ? "1 Entscheidung offen" : `${count} Entscheidungen offen`;
}

/** "N Buchungen buchen" / "1 Buchung buchen". */
export function bookButtonLabel(count: number): string {
  return count === 1 ? "1 Buchung buchen" : `${count} Buchungen buchen`;
}

/** Snackbar after booking: "N Buchungen gebucht." / "1 Buchung gebucht.". */
export function bookedMessage(count: number): string {
  return count === 1 ? "1 Buchung gebucht." : `${count} Buchungen gebucht.`;
}

/** One ledger row as named in a note: "Kauf 15.10.2026, 3,412871 Stück, 150,00 €". */
export function ledgerMatchText(match: Pick<TransactionRecord, "type" | "date" | "quantity" | "amount" | "fee" | "tax">): string {
  const value = match.type === "FEE" ? match.fee : match.type === "TAX" ? match.tax : match.amount;
  const quantity = match.quantity === null ? "" : `, ${formatQuantity(match.quantity)} Stück`;
  return `${transactionTypeLabel(match.type)} ${formatDate(match.date)}${quantity}, ${formatMoney(value)}`;
}

/** Notes under a proposal row: why it is a duplicate or ambiguous; none for a unique one. */
export function proposalNotes(view: Pick<ProposalReviewView, "status" | "ledgerMatches" | "siblingMatch">): string[] {
  if (view.status === "duplicate") {
    const match = view.ledgerMatches[0];
    return [`Bereits gebucht am ${match ? formatDate(match.date) : "?"}. Wird nicht erneut gebucht.`];
  }
  if (view.status !== "ambiguous") return [];
  const notes = view.ledgerMatches.map((match) => `Gleiche Buchung bereits vorhanden: ${ledgerMatchText(match)}.`);
  if (view.siblingMatch) notes.push("Gleiche Buchung mehrfach in diesem Import.");
  notes.push("Bitte entscheiden.");
  return notes;
}

/**
 * Row text of an ISIN-change proposal: "ISIN-Wechsel <old> → <new>, <qty> St. am <dd.mm.yyyy>"; when the
 * quantities differ "<old qty> St. → <new qty> St.".
 */
export function isinChangeText(change: Pick<IsinChangeProposal, "oldIsin" | "newIsin" | "oldQuantity" | "newQuantity" | "date">): string {
  // Both quantities are canonical decimal strings.
  const quantity = change.oldQuantity === change.newQuantity
    ? `${formatQuantity(change.oldQuantity)} St.`
    : `${formatQuantity(change.oldQuantity)} St. → ${formatQuantity(change.newQuantity)} St.`;
  return `ISIN-Wechsel ${change.oldIsin} → ${change.newIsin}, ${quantity} am ${formatDate(change.date)}`;
}

/** The names below the ISIN-change row: "<old name> → <new name>", or only the new name. */
export function isinChangeNames(change: Pick<IsinChangeProposal, "oldName" | "newName">): string {
  return change.oldName ? `${change.oldName} → ${change.newName}` : change.newName;
}

/** Note of an ISIN change that is not booked; none for a unique one. */
export function isinChangeNote(status: IsinChangeReviewStatus): string | null {
  if (status === "recorded") return "Bereits erfasst";
  if (status === "duplicate") return "Bereits in diesem Import.";
  return null;
}

/** Fields of the inline edit with their German labels. */
export const EDIT_FIELD_LABELS: Record<EditableProposalField, string> = {
  date: "Datum",
  quantity: "Stück",
  price: "Kurs",
  amount: "Betrag",
  fee: "Gebühr",
  tax: "Steuer",
};

/** German message for an invalid edited field of a proposal of `type`. */
export function editErrorMessage(field: EditableProposalField, type: ProposalType): string {
  return transactionErrorMessage(`${field}-invalid`, undefined, type);
}

export type ReviewErrorReason =
  | Extract<DecideProposalActionState | UpdateProposalActionState, { ok: false }>["reason"]
  | Exclude<Extract<BookImportBatchActionState, { ok: false }>["reason"], "ledger-rejected">
  | "action-failed";

/** Text with a "refresh" hint: the page no longer shows the current review. */
export const REVIEW_CHANGED_MESSAGE = "Der Import hat sich geändert. Bitte erneut prüfen.";

const REVIEW_ERROR_MESSAGES: Record<ReviewErrorReason, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "not-found": "Import nicht gefunden oder bereits gebucht.",
  invalid: "Bitte die Eingaben prüfen.",
  "decisions-open": "Bitte zuerst alle offenen Entscheidungen treffen.",
  "review-changed": REVIEW_CHANGED_MESSAGE,
  "nothing-to-book": "Keine Buchung zum Buchen ausgewählt.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a failed review action. */
export function reviewErrorMessage(reason: ReviewErrorReason): string {
  return REVIEW_ERROR_MESSAGES[reason];
}

/** Ledger reasons `transactionErrorMessage` knows; any other batch failure gets a generic text. */
const TRANSACTION_REASONS = new Set<string>([
  "depot-not-found",
  "depot-archived",
  "type-invalid",
  "date-invalid",
  "quantity-invalid",
  "price-invalid",
  "fee-invalid",
  "tax-invalid",
  "amount-invalid",
  "security-required",
  "security-not-found",
  "security-not-allowed",
  "isin-invalid",
  "crypto-symbol-invalid",
  "security-name-invalid",
  "asset-type-invalid",
  "sell-exceeds-holding",
  "possible-duplicate",
  "later-sell-exceeds-holding",
]);

/** Ledger reasons `isinChangeErrorMessage` knows. */
const ISIN_CHANGE_REASONS = new Set<string>([
  "security-not-found",
  "same-security",
  "date-invalid",
  "old-quantity-invalid",
  "new-quantity-invalid",
  "isin-change-exists",
  "isin-invalid",
  "crypto-symbol-invalid",
  "security-name-invalid",
  "asset-type-invalid",
  "later-sell-exceeds-holding",
]);

function rejectionText(type: ProposalType | "ISIN_CHANGE" | null, failure: { reason: string }): string {
  const { reason } = failure;
  if (type === "ISIN_CHANGE") {
    return ISIN_CHANGE_REASONS.has(reason)
      ? isinChangeErrorMessage(reason as IsinChangeErrorReason, failureDetail(failure))
      : "Buchung wurde abgelehnt.";
  }
  return TRANSACTION_REASONS.has(reason)
    ? transactionErrorMessage(reason as TransactionErrorReason, failureDetail(failure), type ?? undefined)
    : "Buchung wurde abgelehnt.";
}

/** "<Datei>: <ledger message>" for a booking the ledger rejected (nothing was booked). */
export function ledgerRejectedMessage(result: {
  fileName: string | null;
  type: ProposalType | "ISIN_CHANGE" | null;
  failure: { reason: string };
}): string {
  const message = rejectionText(result.type, result.failure);
  const full = `${message} Es wurde nichts gebucht.`;
  return result.fileName ? `${result.fileName}: ${full}` : full;
}
