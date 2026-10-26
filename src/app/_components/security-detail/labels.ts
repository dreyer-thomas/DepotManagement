import { formatMoney, formatQuantity } from "@/core/format";
import type { SecuritySummary } from "@/modules/ledger";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

export const NO_TRANSACTIONS_TEXT = "Noch keine Buchungen.";
export const NO_LOTS_TEXT = "Keine offenen Kaufposten.";
export const NO_PRICE_TEXT = "Kein Kurs vorhanden.";
export const STALE_HINT_TEXT = "Keine Kursquelle liefert aktuelle Kurse.";
export const ALL_DEPOTS_LABEL = "Alle Depots";
export const MISSING = "–";

/** The Security detail page, optionally with a Depot selected: `/securities/<id>?depot=<depotId>`. */
export function securityHref(securityId: string, depotId?: string | null): string {
  const base = `/securities/${encodeURIComponent(securityId)}`;
  return depotId ? `${base}?depot=${encodeURIComponent(depotId)}` : base;
}

/** Header caption: `IE00B4L5Y983 · ETF` (crypto: the symbol). */
export function securityCaption(security: Pick<SecuritySummary, "isin" | "cryptoSymbol" | "assetType">): string {
  return `${security.isin ?? security.cryptoSymbol ?? ""} · ${ASSET_TYPE_LABELS[security.assetType]}`;
}

/** Hero label: `Wert · 310 Stück à 112,46 €`, without a price `Wert · 310 Stück`. */
export function heroLabel(quantity: string, price: string | null): string {
  const base = `Wert · ${formatQuantity(quantity)} Stück`;
  return price === null ? base : `${base} à ${formatMoney(price)}`;
}

/** Depot switcher label: the name, `(archiviert)` appended for an archived Depot. */
export function depotLabel(depot: { name: string; archived: boolean }): string {
  return depot.archived ? `${depot.name} (archiviert)` : depot.name;
}
