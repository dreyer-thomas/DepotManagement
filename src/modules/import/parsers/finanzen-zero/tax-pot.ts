// finanzen.net zero / Baader Bank tax-pot notice ("Verlusttopfoptimierung", "Anpassung in den bei uns für
// Sie geführten Steuertöpfen"): only the tax pots change, so the document needs no booking. A notice that
// also posts to the account is not read.
import type { Parser } from "../../proposal";
import { isBaaderDocument } from "./positions";
import { NO_BOOKING_INFO, STORNO_REASON, TAX_POT_WITH_POSTING_REASON } from "./reasons";

const TITLE = /^[ \t]*Verlusttopfoptimierung[ \t]*$/m;
const PHRASE = "Anpassung in den bei uns für Sie geführten Steuertöpfen";
const ACCOUNT_POSTING = /Zu\s+Lasten\s+Konto|Zu\s+Gunsten\s+Konto|erstatten\s+wir|belasten\s+wir/;
const STORNO = /Storno/i;

/** Reads a tax-pot notice as a document needing no booking. */
export const parseFinanzenZeroTaxPot: Parser = (text) => {
  // The phrase may wrap across lines.
  if (!isBaaderDocument(text) || !(TITLE.test(text) || text.replace(/\s+/g, " ").includes(PHRASE))) return { error: "unrecognized" };
  if (STORNO.test(text)) return { error: "invalid", message: STORNO_REASON };
  if (ACCOUNT_POSTING.test(text)) return { error: "invalid", message: TAX_POT_WITH_POSTING_REASON };
  return { proposals: [], noBooking: NO_BOOKING_INFO };
};
