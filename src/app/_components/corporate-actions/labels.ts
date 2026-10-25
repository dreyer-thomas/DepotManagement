import { formatDate } from "@/core/format";
import type { SplitFailureReason } from "@/modules/ledger";

export type SplitErrorReason = SplitFailureReason | "unauthorized";

const MESSAGES: Record<Exclude<SplitErrorReason, "later-sell-exceeds-holding">, string> = {
  "security-not-found": "Security nicht gefunden.",
  "date-invalid": "Bitte ein gültiges Datum eingeben.",
  "ratio-invalid": "Bitte ein Verhältnis wie 1:4 eingeben (ganze Zahlen größer 0, verschieden).",
  "split-exists": "Für dieses Datum ist bereits ein Split erfasst.",
  "split-not-found": "Split nicht gefunden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a split write failure; `date` is the SELL's date on `later-sell-exceeds-holding`. */
export function splitErrorMessage(reason: SplitErrorReason, date?: string): string {
  if (reason === "later-sell-exceeds-holding") {
    return `Nicht möglich: Der Verkauf am ${date ? formatDate(date) : "?"} würde den Bestand übersteigen.`;
  }
  return MESSAGES[reason];
}

/** Which form field an error belongs to; others show as an Alert. */
export function splitErrorField(reason: SplitErrorReason): "ratio" | "date" | undefined {
  if (reason === "ratio-invalid") return "ratio";
  if (reason === "date-invalid" || reason === "split-exists") return "date";
  return undefined;
}

/** A split ratio for display, e.g. `1:4`. */
export function formatSplitRatio(split: { ratioOld: string; ratioNew: string }): string {
  return `${split.ratioOld}:${split.ratioNew}`;
}
