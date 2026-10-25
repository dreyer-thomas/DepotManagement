import { ExactDecimal } from "@/core/decimal";
import type { PositionRecord } from "@/modules/ledger";

export const POSITION_SORT_KEYS = ["name", "quantity", "costBasis", "averagePrice", "price", "value", "gain"] as const;
export type PositionSortKey = (typeof POSITION_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export const POSITION_SORT_LABELS: Record<PositionSortKey, string> = {
  name: "Wertpapier",
  quantity: "Stück",
  costBasis: "Einstandswert",
  averagePrice: "Ø Kaufkurs",
  price: "Kurs",
  value: "Wert",
  gain: "G/V",
};

export const DEFAULT_POSITION_SORT: PositionSort = { key: "value", direction: "desc" };

/** Direction a column starts in when first chosen: names A→Z, figures largest first. */
export const initialSortDirection = (key: PositionSortKey): SortDirection => (key === "name" ? "asc" : "desc");

export type PositionSort = { key: PositionSortKey; direction: SortDirection };

/** Header click: the active key flips its direction, a new key starts in its initial direction. */
export function nextSort(current: PositionSort, key: PositionSortKey): PositionSort {
  if (current.key === key) return toggleSortDirection(current);
  return { key, direction: initialSortDirection(key) };
}

/** Phone select: always starts the chosen key in its initial direction. */
export const selectSortKey = (key: PositionSortKey): PositionSort => ({ key, direction: initialSortDirection(key) });

/** Phone direction button: same key, opposite direction. */
export const toggleSortDirection = (current: PositionSort): PositionSort => ({
  key: current.key,
  direction: current.direction === "asc" ? "desc" : "asc",
});

type SortablePosition = Pick<PositionRecord, Exclude<PositionSortKey, "name">> & { security: { id: string; name: string } };

const byName = (a: SortablePosition, b: SortablePosition) =>
  a.security.name.localeCompare(b.security.name, "de") || (a.security.id < b.security.id ? -1 : a.security.id > b.security.id ? 1 : 0);

/**
 * Positions sorted by `key` in `direction`; decimal strings compare exactly, `null` values always
 * come last, ties fall back to the name. Returns a new array.
 */
export function sortPositions<T extends SortablePosition>(rows: readonly T[], key: PositionSortKey, direction: SortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    const left = a[key];
    const right = b[key];
    if (left === null || right === null) {
      if (left === right) return byName(a, b);
      return left === null ? 1 : -1;
    }
    return sign * new ExactDecimal(left).comparedTo(right) || byName(a, b);
  });
}
