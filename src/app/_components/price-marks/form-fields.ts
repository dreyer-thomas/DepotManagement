/**
 * FormData names of the price-mark fields (story 12.2), shared by `PriceMarkFields`, the marks dialog, the
 * watchlist entry dialog and the server actions, so a rename on either side fails typecheck.
 */
import type { PriceMarksForm } from "@/core/price-marks";

export const PRICE_MARK_FIELDS = {
  securityId: "securityId",
  stopType: "stopType",
  stopValue: "stopValue",
  stopSource: "stopSource",
  stopSetDate: "stopSetDate",
  targetPrice: "targetPrice",
  targetSource: "targetSource",
  targetSetDate: "targetSetDate",
  /** Present (`PRICE_MARKS_MARKER`) when a form carries the marks fields; the watchlist action writes marks only then. */
  priceMarks: "priceMarks",
} as const satisfies Record<keyof PriceMarksForm | "securityId" | "priceMarks", string>;

export const PRICE_MARKS_MARKER = "1";

/** The raw marks fields of a submitted form (missing or non-string values become ""). */
export function priceMarksFormOf(formData: FormData): PriceMarksForm {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    stopType: text(PRICE_MARK_FIELDS.stopType),
    stopValue: text(PRICE_MARK_FIELDS.stopValue),
    stopSource: text(PRICE_MARK_FIELDS.stopSource),
    stopSetDate: text(PRICE_MARK_FIELDS.stopSetDate),
    targetPrice: text(PRICE_MARK_FIELDS.targetPrice),
    targetSource: text(PRICE_MARK_FIELDS.targetSource),
    targetSetDate: text(PRICE_MARK_FIELDS.targetSetDate),
  };
}
