import type {
  ConfirmParqetActionResult,
  OpeningBalanceActionResult,
  PreviewParqetActionState,
} from "@/app/_actions/migration";
import {
  isinChangeErrorMessage,
  type IsinChangeErrorReason,
  splitErrorMessage,
  type SplitErrorReason,
} from "@/app/_components/corporate-actions/labels";
import {
  failureDetail,
  TRANSACTION_TYPE_LABELS,
  type TransactionErrorReason,
  transactionErrorMessage,
} from "@/app/_components/transactions/labels";
import { formatDate, formatMoney } from "@/core/format";
import type { AssetType } from "@/modules/ledger";
import type {
  BookingFailure,
  BookingItem,
  ClassificationType,
  CorrectionType,
  FlaggedRow,
  ProposalType,
  RawRow,
} from "@/modules/migration";

type Failure = Extract<NonNullable<PreviewParqetActionState>, { ok: false }>;
export type PreviewFailureReason = Failure["reason"];

const FAILURE_MESSAGES: Record<Exclude<PreviewFailureReason, "missing-columns">, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "file-missing": "Bitte eine CSV-Datei auswählen.",
  "file-too-large": "Die Datei ist größer als 5 MB.",
  "depot-not-found": "Depot nicht gefunden.",
  "depot-archived": "Depot ist archiviert. Bitte zuerst reaktivieren.",
  "empty-file": "Die Datei enthält keine Zeilen.",
};

/** German message for a failed preview; `columns` lists what a file without required columns lacks. */
export function previewFailureMessage(failure: { reason: PreviewFailureReason; columns?: string[] }): string {
  if (failure.reason === "missing-columns") {
    return `Das ist kein Parqet-Export: Es fehlen die Spalten ${(failure.columns ?? []).join(", ")}.`;
  }
  return FAILURE_MESSAGES[failure.reason];
}

/** German reason of a flagged row, with its detail (column, currency or row kind). */
export function flagReasonLabel(flag: Pick<FlaggedRow, "reason" | "detail">): string {
  switch (flag.reason) {
    case "unparseable":
      return flag.detail ? `Nicht lesbar (Spalte „${flag.detail}“)` : "Nicht lesbar (falsche Anzahl Felder)";
    case "non-eur":
      return `Keine Euro-Buchung (Währung ${flag.detail ? flag.detail : "leer"})`;
    case "unsupported-row":
      return flag.detail ? `Nicht unterstützte Zeile (${flag.detail})` : "Nicht unterstützte Zeile";
    case "unpaired-security-transfer":
      return "Ausgehender Wertpapier-Übertrag ohne passenden Eingang";
    case "unsupported-split":
      return "Split-Verhältnis nicht darstellbar";
    case "cash-pair-mismatch":
      return "Buchung und Barbuchung weichen um mehr als 0,01 € ab";
  }
}

/** A skipped flag in the summary: `Zeilen 4, 5: Keine Euro-Buchung (Währung USD)`. */
export function skippedFlagLabel(flag: Pick<FlaggedRow, "records" | "reason" | "detail">): string {
  return `${recordsLabel(flag.records)}: ${flagReasonLabel(flag)}`;
}

/** `Zeile 5` / `Zeilen 4, 5` (CSV record numbers, header = 1). */
export function recordsLabel(records: readonly number[]): string {
  return `${records.length === 1 ? "Zeile" : "Zeilen"} ${records.join(", ")}`;
}

/** Proposal types in display order. */
export const PROPOSAL_TYPE_ORDER: ProposalType[] = ["BUY", "SELL", "DIVIDEND", "TAX", "DEPOSIT", "WITHDRAWAL"];

/** German label of a proposed Transaction type. */
export function proposalTypeLabel(type: ProposalType): string {
  return TRANSACTION_TYPE_LABELS[type];
}

/** Rows of the counts table: every proposal type with its German label and count. */
export function countRows(counts: Record<ProposalType, number>): { type: ProposalType; label: string; count: number }[] {
  return PROPOSAL_TYPE_ORDER.map((type) => ({ type, label: proposalTypeLabel(type), count: counts[type] }));
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  STOCK: "Aktie",
  ETF: "ETF",
  FUND: "Fonds",
  CERTIFICATE: "Zertifikat",
  CRYPTO: "Krypto",
  UNCLASSIFIED: "Typ unbekannt",
};

/** Chip text of a Security's (stored or proposed) type; `UNCLASSIFIED` reads "Typ unbekannt". */
export function securityTypeLabel(assetType: AssetType): string {
  return ASSET_TYPE_LABELS[assetType];
}

/** Labels of the types a new Security can be classified as, in selection order. */
export const CLASSIFICATION_OPTIONS: { value: ClassificationType; label: string }[] = [
  { value: "STOCK", label: "Aktie" },
  { value: "ETF", label: "ETF" },
  { value: "FUND", label: "Fonds" },
  { value: "CERTIFICATE", label: "Zertifikat" },
];

/** Transaction types a flagged row can be corrected to, with German labels, in selection order. */
export const CORRECTION_TYPE_OPTIONS: { value: CorrectionType; label: string }[] = (
  ["BUY", "SELL", "DIVIDEND", "TAX", "DEPOSIT", "WITHDRAWAL"] as const
).map((value) => ({ value, label: TRANSACTION_TYPE_LABELS[value] }));

export const DECISION_LABELS = {
  skip: "Überspringen",
  book: "Trotzdem buchen",
  correct: "Korrigiert buchen",
} as const;

/** Shown when a server action was rejected (network, timeout): whether anything was booked is unknown. */
export const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte das Depot prüfen, bevor du es erneut versuchst.";

/** "Offene Entscheidungen: 3". */
export function openDecisionsLabel(count: number): string {
  return `Offene Entscheidungen: ${count}`;
}

/** Preview note for a file without Cash rows: "Export ohne Kontobewegungen: 3 Einzahlungen werden ergänzt". */
export function fundingNote(count: number): string {
  return `Export ohne Kontobewegungen: ${count === 1 ? "1 Einzahlung wird" : `${count} Einzahlungen werden`} ergänzt`;
}

/** The raw text of a flagged CSV record, e.g. `TransferIn · Security · IE00B4L5Y983 · Welt ETF · Stück 3 · …`. */
export function rawRowLabel(row: RawRow): string {
  const parts = [row.datetime, row.type, row.assettype, row.identifier, row.holdingname];
  const figures: [string, string][] = [
    ["Stück", row.shares],
    ["Kurs", row.price],
    ["Betrag", row.amount],
    ["Gebühr", row.fee],
    ["Steuer", row.tax],
  ];
  for (const [label, value] of figures) if (value !== "") parts.push(`${label} ${value}`);
  if (row.currency !== "") parts.push(row.currency);
  return parts.filter((part) => part !== "").join(" · ");
}

/** The item a booking failure belongs to, in German, e.g. `Zeilen 10, 11 (Verkauf vom 03.06.2024)`. */
export function bookingItemLabel(item: BookingItem): string {
  const on = (date: string) => (date ? ` vom ${safeDate(date)}` : "");
  switch (item.kind) {
    case "depot":
      return "Depot";
    case "security":
      return `Wertpapier ${item.key}`;
    case "proposal":
      return `${recordsLabel(item.records)} (${proposalTypeLabel(item.type)}${on(item.date)})`;
    case "flag":
      return `Markierte ${recordsLabel(item.records)} (korrigiert als ${TRANSACTION_TYPE_LABELS[item.type]}${on(item.date)})`;
    case "isin-change":
      return `${recordsLabel(item.records)} (ISIN-Wechsel ${item.oldKey} → ${item.newKey}${on(item.date)})`;
    case "split":
      return `${recordsLabel(item.records)} (Split ${item.ratio} von ${item.securityKey}${on(item.date)})`;
  }
}

function safeDate(date: string): string {
  try {
    return formatDate(date);
  } catch {
    return date;
  }
}

const ISIN_CHANGE_ONLY_REASONS = new Set<string>([
  "same-security",
  "old-quantity-invalid",
  "new-quantity-invalid",
  "isin-change-exists",
  "isin-change-not-found",
]);

/** Why booking stopped, naming the item: `Zeile 2 (Verkauf vom 01.03.2024): Verkauf übersteigt Bestand (0 Stück).` */
export function bookingFailureMessage(item: BookingItem, failure: BookingFailure): string {
  let reason: string;
  if (failure.reason === "security-ref-unknown") {
    reason = "Wertpapier fehlt.";
  } else if (item.kind === "split") {
    reason = splitErrorMessage(failure.reason as SplitErrorReason, failureDetail(failure));
  } else if (item.kind === "isin-change" || ISIN_CHANGE_ONLY_REASONS.has(failure.reason)) {
    reason = isinChangeErrorMessage(failure.reason as IsinChangeErrorReason, failureDetail(failure));
  } else {
    const type = item.kind === "proposal" || item.kind === "flag" ? item.type : undefined;
    reason = transactionErrorMessage(failure.reason as TransactionErrorReason, failureDetail(failure), type);
  }
  return `Nicht gebucht – ${bookingItemLabel(item)}: ${reason} Es wurde nichts übernommen.`;
}

type ConfirmFailure = Extract<ConfirmParqetActionResult, { ok: false }>;

/** German message for a failed confirmation. */
export function confirmFailureMessage(failure: ConfirmFailure): string {
  switch (failure.reason) {
    case "booking-failed":
      return bookingFailureMessage(failure.item, failure.failure);
    case "decisions-open":
      return "Seit der Vorschau hat sich etwas geändert: Bitte die offenen Entscheidungen prüfen. Es wurde nichts übernommen.";
    case "decisions-invalid":
      return "Die Entscheidungen konnten nicht gelesen werden. Bitte die Vorschau neu laden.";
    case "missing-columns":
      return previewFailureMessage(failure);
    default:
      return previewFailureMessage({ reason: failure.reason });
  }
}

type OpeningFailure = Extract<OpeningBalanceActionResult, { ok: false }>;

/** German message for a failed opening booking; `asOf` is the export date. */
export function openingBalanceFailureMessage(failure: OpeningFailure, asOf: string): string {
  switch (failure.reason) {
    case "balance-invalid":
      return "Bitte einen gültigen Saldo eingeben, z. B. 1.234,56.";
    case "date-after-export":
      return `Das Buchungsdatum darf nicht nach dem ${safeDate(asOf)} liegen.`;
    case "date-invalid":
      return "Bitte ein gültiges Datum eingeben.";
    default:
      return transactionErrorMessage(failure.reason, failureDetail(failure));
  }
}

/** Success text of the opening booking. */
export function openingBalanceSuccess(
  result: Extract<OpeningBalanceActionResult, { ok: true }>,
  asOf: string,
): string {
  if (!result.transaction) return `Nichts zu buchen: Der Saldo am ${safeDate(asOf)} stimmt bereits (${formatMoney(result.balance)}).`;
  const type = TRANSACTION_TYPE_LABELS[result.transaction.type];
  return `${type} über ${formatMoney(result.transaction.amount)} am ${safeDate(result.transaction.date)} gebucht. Saldo am ${safeDate(asOf)}: ${formatMoney(result.balance)}.`;
}

/** The status text of a compared figure; differences are named in words, never by color alone. */
export function comparisonStatus(mismatch: boolean): string {
  return mismatch ? "Abweichung" : "gleich";
}
