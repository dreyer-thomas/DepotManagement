// finanzen.net zero / Baader Bank corporate-action notices (ISIN change, split, merger, spin-off, …). Tried
// first: such a notice is never booked as a trade and always fails with the Corporate Action hint.
import type { Parser } from "../../proposal";
import { isBaaderDocument } from "./positions";
import { CORPORATE_ACTION_REASON } from "./reasons";

const TITLE =
  /^[ \t]*(?:Obligatorischer Umtausch|Freiwilliger Umtausch|Umtausch|Aktiensplit|Reverse Split|Split|Kapitalerhöhung|Kapitalherabsetzung|Spin-off|Abspaltung|Fusion|Verschmelzung)[ \t]*$/m;
const DEPOT_POSTING = /Einbuchung in Depot|Ausbuchung aus Depot/;

/** Claims a Baader corporate-action notice and fails it with the Corporate Action hint. */
export const parseFinanzenZeroCorporateAction: Parser = (text) => {
  if (!isBaaderDocument(text) || !(TITLE.test(text) || DEPOT_POSTING.test(text))) return { error: "unrecognized" };
  return { error: "invalid", message: CORPORATE_ACTION_REASON };
};
