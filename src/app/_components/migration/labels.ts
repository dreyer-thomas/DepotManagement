import type { PreviewParqetActionState } from "@/app/_actions/migration";
import { TRANSACTION_TYPE_LABELS } from "@/app/_components/transactions/labels";
import type { AssetType } from "@/modules/ledger";
import type { FlaggedRow, ProposalType } from "@/modules/migration";

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
      return "Wertpapier-Übertrag ohne passendes Gegenstück";
    case "cash-pair-mismatch":
      return "Buchung und Barbuchung weichen um mehr als 0,01 € ab";
  }
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
  CERTIFICATE: "Zertifikat",
  CRYPTO: "Krypto",
  UNCLASSIFIED: "Typ unbekannt",
};

/** Chip text of a Security's (stored or proposed) type; `UNCLASSIFIED` reads "Typ unbekannt". */
export function securityTypeLabel(assetType: AssetType): string {
  return ASSET_TYPE_LABELS[assetType];
}
