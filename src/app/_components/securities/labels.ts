import type { AssetType } from "@/modules/ledger";
import type { PriceProvider, ProviderMappingSummary, SetMappingFailureReason } from "@/modules/prices";
import { securityTypeLabel } from "@/app/_components/migration/labels";

/** German display names of the price providers, in selection order. */
export const PROVIDER_LABELS: Record<PriceProvider, string> = {
  YAHOO: "Yahoo Finance",
  ONVISTA: "onvista",
  COINGECKO: "CoinGecko",
};

export const PROVIDER_OPTIONS = Object.entries(PROVIDER_LABELS).map(([value, label]) => ({
  value: value as PriceProvider,
  label,
}));

export const MAPPING_PENDING_TEXT = "Kursquelle noch nicht ermittelt";
export const MAPPING_NOT_FOUND_TEXT = "Keine Kursquelle gefunden";

/** "Yahoo Finance · SAP.DE", "Keine Kursquelle gefunden" (marker) or "Kursquelle noch nicht ermittelt" (no row yet). */
export function mappingLabel(mapping: ProviderMappingSummary | null): string {
  if (!mapping) return MAPPING_PENDING_TEXT;
  if (!mapping.provider || !mapping.symbol) return MAPPING_NOT_FOUND_TEXT;
  return `${PROVIDER_LABELS[mapping.provider]} · ${mapping.symbol}`;
}

/** Type options for "Typ ändern" with German labels; `UNCLASSIFIED` is never offered. */
export function typeOptions(types: readonly AssetType[]): { value: AssetType; label: string }[] {
  return types.filter((type) => type !== "UNCLASSIFIED").map((value) => ({ value, label: securityTypeLabel(value) }));
}

export type SecurityErrorReason =
  | SetMappingFailureReason
  | "asset-type-invalid"
  | "unauthorized"
  | "already-mapped"
  | "provider-failed";

const ERROR_MESSAGES: Record<SecurityErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "provider-invalid": "Bitte eine Kursquelle wählen.",
  "symbol-invalid": "Bitte ein Symbol eingeben (höchstens 40 Zeichen: Buchstaben, Ziffern, . ^ = _ -).",
  "asset-type-invalid": "Bitte einen passenden Typ wählen.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "already-mapped": "Für dieses Wertpapier ist bereits eine Kursquelle eingetragen.",
  "provider-failed": "Kursquelle konnte gerade nicht ermittelt werden. Bitte später erneut versuchen.",
};

/** German message for a failed Securities-page write. */
export function securityErrorMessage(reason: SecurityErrorReason): string {
  return ERROR_MESSAGES[reason];
}

/** Shown when a server action was rejected (network, timeout). */
export const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";

/** Alert text after an auto-resolver run with failures, naming the Securities. */
export function resolveFailedMessage(names: readonly string[]): string {
  const list = names.join(", ");
  return names.length === 1
    ? `Für ${list} konnte die Kursquelle gerade nicht ermittelt werden.`
    : `Für ${names.length} Wertpapiere konnte die Kursquelle gerade nicht ermittelt werden: ${list}.`;
}

export type LogoErrorReason = "not-found" | "file-missing" | "file-too-large" | "file-type" | "unauthorized";

const LOGO_ERROR_MESSAGES: Record<LogoErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "file-missing": "Bitte eine Bilddatei wählen.",
  "file-too-large": "Die Datei ist größer als 1 MB.",
  "file-type": "Bitte eine PNG-, JPEG- oder WebP-Datei wählen.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed logo upload. */
export function logoErrorMessage(reason: LogoErrorReason): string {
  return LOGO_ERROR_MESSAGES[reason];
}
