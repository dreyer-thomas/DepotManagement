import { formatDate, formatDateTime } from "@/core/format";
import type { PriceSource } from "@/core/prices";
import { PROVIDER_LABELS } from "@/app/_components/securities/labels";

/** What the date line, stale badge and tooltip need to know about a resolved price. */
export type PriceDateInfo = {
  date: string;
  source: PriceSource;
  /** UTC ISO fetch / entry time; null for a Transaction price. */
  fetchedAt: string | null;
  /** Provider of a provider price (e.g. `YAHOO`); null otherwise. */
  provider: string | null;
  stale: boolean;
};

/** German display name of a provider (`YAHOO` → "Yahoo Finance"); unknown values are shown as they are. */
export function providerLabel(provider: string | null): string {
  if (!provider) return "Kursanbieter";
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

/** "Kurs vom 22.10.2026", stale: "Kurs vom 22.10.2026 – veraltet". */
export function priceDateText(date: string, stale: boolean): string {
  return `Kurs vom ${formatDate(date)}${stale ? " – veraltet" : ""}`;
}

/**
 * Tooltip text naming the source and fetch time: "Yahoo Finance · abgerufen 23.10.2026, 20:05",
 * "Manuell eingetragen · 23.10.2026, 20:05" or "Buchungskurs".
 */
export function priceSourceText({ source, fetchedAt, provider }: Pick<PriceDateInfo, "source" | "fetchedAt" | "provider">): string {
  if (source === "transaction") return "Buchungskurs";
  const time = fetchedAt ? formatDateTime(fetchedAt) : null;
  if (source === "manual") return time ? `Manuell eingetragen · ${time}` : "Manuell eingetragen";
  return time ? `${providerLabel(provider)} · abgerufen ${time}` : providerLabel(provider);
}

/** Row-level fetch failure: "Kurs konnte nicht von Yahoo Finance geladen werden." */
export function fetchErrorText(provider: string | null): string {
  return `Kurs konnte nicht von ${providerLabel(provider)} geladen werden.`;
}

/** Snackbar after "Kurse aktualisieren", naming every failed Security. */
export function refreshResultText(failedNames: readonly string[]): string {
  return failedNames.length === 0 ? "Kurse aktualisiert." : `Kurse aktualisiert. Fehlgeschlagen: ${failedNames.join(", ")}`;
}

export type ManualPriceErrorReason = "not-found" | "date-invalid" | "price-invalid" | "unauthorized";

const MANUAL_PRICE_ERRORS: Record<ManualPriceErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "date-invalid": "Bitte ein gültiges Datum bis heute wählen.",
  "price-invalid": "Bitte einen Kurs größer als 0 eingeben, z. B. 12,34.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed manual-price entry. */
export function manualPriceErrorMessage(reason: ManualPriceErrorReason): string {
  return MANUAL_PRICE_ERRORS[reason];
}
