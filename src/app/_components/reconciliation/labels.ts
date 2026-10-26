import { failureDetail, transactionErrorMessage, type TransactionErrorReason } from "@/app/_components/transactions/labels";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { ReconciliationRowRecord } from "@/modules/ledger";

/** Name of a row: the Security, or the Cash Account. */
export function rowName(row: Pick<ReconciliationRowRecord, "securityId" | "security">): string {
  return row.securityId === null ? "Cash-Konto" : (row.security?.name ?? "Unbekannte Security");
}

/** A row value as shown: `12 Stück` for a Position, `1.234,56 €` for the Cash Account. */
export function rowValueText(isCash: boolean, value: string): string {
  return isCash ? formatMoney(value) : `${formatQuantity(value)} Stück`;
}

/** A row value as an input shows it: decimal comma, no grouping. */
export function inputValue(value: string | null): string {
  return value === null ? "" : value.replace(".", ",");
}

/** Status text: "abgeglichen", "Differenz +2 Stück" / "Differenz -12,34 €", or "offen" (never colour alone). */
export function statusText(row: Pick<ReconciliationRowRecord, "securityId" | "status" | "difference">): string {
  if (row.status === "reconciled") return "abgeglichen";
  if (row.status === "open" || row.difference === null) return "offen";
  const difference =
    row.securityId === null ? formatMoney(row.difference, { sign: true }) : `${formatQuantity(row.difference, { sign: true })} Stück`;
  return `Differenz ${difference}`;
}

/** "x von y abgeglichen". */
export function progressText(progress: { reconciled: number; total: number }): string {
  return `${progress.reconciled} von ${progress.total} abgeglichen`;
}

/** "Stichtag dd.mm.yyyy". */
export function statementDateText(date: string): string {
  return `Stichtag ${formatDate(date)}`;
}

/** The one confirmation before finishing with rows that are not reconciled. */
export function finishConfirmText(open: number): string {
  return `Noch ${open} ${open === 1 ? "Zeile" : "Zeilen"} offen. Trotzdem abschließen?`;
}

/** "Zuletzt abgeglichen am dd.mm.yyyy". */
export function lastReconciledText(date: string): string {
  return `Zuletzt abgeglichen am ${formatDate(date)}`;
}

/** "Abgleich fortsetzen (Stichtag dd.mm.yyyy)". */
export function continueText(date: string): string {
  return `Abgleich fortsetzen (${statementDateText(date)})`;
}

const MESSAGES: Record<string, string> = {
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "depot-not-found": "Depot nicht gefunden.",
  "depot-archived": "Depot ist archiviert. Bitte zuerst reaktivieren.",
  "date-invalid": "Bitte einen gültigen Stichtag eingeben.",
  "date-in-future": "Der Stichtag darf nicht in der Zukunft liegen.",
  "run-open": "Für dieses Depot läuft bereits ein Abgleich.",
  "run-not-found": "Abgleich nicht gefunden. Bitte die Seite neu laden.",
  "run-finished": "Dieser Abgleich ist bereits abgeschlossen.",
  "row-not-found": "Diese Zeile gehört nicht zum Abgleich.",
  "value-invalid": "Bitte einen gültigen Wert eingeben (Stück: mindestens 0, höchstens 8 Nachkommastellen).",
  "price-invalid": "Bitte einen Einstandskurs von mindestens 0 eingeben.",
  "no-difference": "Keine Differenz zu buchen.",
};

/** German message for a failed reconciliation action; ledger Transaction failures use their own texts. */
export function reconciliationErrorMessage(failure: { reason: string }, isCash = false): string {
  if (isCash && failure.reason === "value-invalid") return "Bitte einen gültigen Betrag eingeben.";
  if (Object.hasOwn(MESSAGES, failure.reason)) return MESSAGES[failure.reason];
  return transactionErrorMessage(
    failure.reason as TransactionErrorReason,
    failureDetail(failure),
    isCash ? undefined : "ADJUSTMENT",
  );
}
