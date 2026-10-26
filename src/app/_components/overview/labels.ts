import { ExactDecimal } from "@/core/decimal";
import { formatQuantity } from "@/core/format";
import type { PositionRecord } from "@/modules/ledger";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

/** Stale Alert text: `Kurse für N Wertpapiere veraltet.`, singular for one. */
export function staleAlertText(count: number): string {
  return count === 1 ? "Kurs für 1 Wertpapier veraltet." : `Kurse für ${count} Wertpapiere veraltet.`;
}

/** An open Position of one Depot, as the Overview's "Top-Positionen" lists it. */
export type DepotPosition = { depotName: string; position: PositionRecord };

/** Number of rows in "Top-Positionen". */
export const TOP_POSITIONS = 5;

/** The `limit` largest Positions by value (descending); Positions without a price come last. */
export function topPositions(entries: readonly DepotPosition[], limit = TOP_POSITIONS): DepotPosition[] {
  return [...entries]
    .sort((a, b) => {
      const va = a.position.value;
      const vb = b.position.value;
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      return new ExactDecimal(vb).comparedTo(va);
    })
    .slice(0, limit);
}

/** Quantity with its unit: `310 Stück`, for crypto `0,06512 BTC`. */
export function quantityText(position: PositionRecord): string {
  const { assetType, cryptoSymbol } = position.security;
  const unit = assetType === "CRYPTO" && cryptoSymbol ? cryptoSymbol : "Stück";
  return `${formatQuantity(position.quantity)} ${unit}`;
}

/** Caption of a top Position: `ETF · comdirect · 310 Stück`. */
export function positionCaption({ depotName, position }: DepotPosition): string {
  return `${ASSET_TYPE_LABELS[position.security.assetType]} · ${depotName} · ${quantityText(position)}`;
}

/** Tone of a return ratio as displayed (percent rounded to two decimals): `null` when it shows as 0,00 %. */
export function ratioTone(ratio: string): "gain" | "loss" | null {
  const shown = new ExactDecimal(ratio).times(100).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
  if (shown.isZero()) return null;
  return shown.isNegative() ? "loss" : "gain";
}
