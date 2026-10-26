// finanzen.net zero / Baader Bank corporate-action notices (ISIN change, split, merger, spin-off, …). Tried
// first: such a notice is never booked as a trade. A readable ISIN change (story 5-6) becomes an ISIN-change
// proposal; every other claimed notice fails with the Corporate Action hint and is never offered for manual
// Transaction entry.
//
// Page 1 of the notice is scrambled by text extraction (the new name floats after the second "Nominale"), so
// names, quantities and ISINs come from the clean page-2 "Fortsetzung" blocks ("Ausbuchung" / "Einbuchung",
// each followed by "Stück <qty> <name>" and "ISIN: <ISIN>") and only the date from the page-1 "per" lines.
import type { IsinChangeProposalInput, Parser, ParseError } from "../../proposal";
import { isinChangeProposalSchema } from "../../proposal";
import { AMOUNT_PATTERN, DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import { isBaaderDocument } from "./positions";
import { CORPORATE_ACTION_REASON } from "./reasons";

const TITLE =
  /^[ \t]*(?:Obligatorischer Umtausch|Freiwilliger Umtausch|Umtausch|Aktiensplit|Reverse Split|Split|Kapitalerhöhung|Kapitalherabsetzung|Spin-off|Abspaltung|Fusion|Verschmelzung)[ \t]*$/m;
const DEPOT_POSTING = /Einbuchung in Depot|Ausbuchung aus Depot/;

// "Ausbuchung aus Depot 1234567001 per 13.08.2026": any mention, and the exact line with its date.
const OUT_MENTION = /Ausbuchung aus Depot/g;
const IN_MENTION = /Einbuchung in Depot/g;
const OUT_LINE = new RegExp(String.raw`^[ \t]*Ausbuchung aus Depot[ \t]+\S+[ \t]+per[ \t]+(${DATE_PATTERN})[ \t]*$`, "gm");
const IN_LINE = new RegExp(String.raw`^[ \t]*Einbuchung in Depot[ \t]+\S+[ \t]+per[ \t]+(${DATE_PATTERN})[ \t]*$`, "gm");

// Page-2 block headings, alone on their line.
const OUT_HEADING = /^[ \t]*Ausbuchung[ \t]*$/gm;
const IN_HEADING = /^[ \t]*Einbuchung[ \t]*$/gm;

/** A page-2 block: the heading, then "Stück <qty> <name>", then "ISIN: <ISIN>". */
function blockPattern(heading: string): RegExp {
  return new RegExp(
    String.raw`^[ \t]*${heading}[ \t]*\n[ \t]*Stück[ \t]+(${AMOUNT_PATTERN})[ \t]+(\S[^\n]*?)[ \t]*\n[ \t]*ISIN:[ \t]*(${ISIN_PATTERN})[ \t]*$`,
    "m",
  );
}
const OUT_BLOCK = blockPattern("Ausbuchung");
const IN_BLOCK = blockPattern("Einbuchung");

/** Anything that moves cash or leaves a remainder: not a plain ISIN change. */
const NOT_PLAIN = /Zu Lasten|Zu Gunsten|Barausgleich|Spitze/i;

const CORPORATE_ACTION: ParseError = { error: "invalid", message: CORPORATE_ACTION_REASON, corporateAction: true };

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/** The ISIN change of a plain exchange notice; `null` when the notice is anything else or unreadable. */
function readIsinChange(text: string): IsinChangeProposalInput | null {
  if (NOT_PLAIN.test(text)) return null;
  if (count(text, OUT_MENTION) !== 1 || count(text, IN_MENTION) !== 1) return null;
  const outLines = [...text.matchAll(OUT_LINE)];
  const inLines = [...text.matchAll(IN_LINE)];
  if (outLines.length !== 1 || inLines.length !== 1) return null;
  if (outLines[0][1] !== inLines[0][1]) return null;
  const date = germanDate(outLines[0][1]);
  if (date === null) return null;

  if (count(text, OUT_HEADING) !== 1 || count(text, IN_HEADING) !== 1) return null;
  const out = OUT_BLOCK.exec(text);
  const into = IN_BLOCK.exec(text);
  if (!out || !into) return null;
  const oldQuantity = germanAmount(out[1]);
  const newQuantity = germanAmount(into[1]);
  if (oldQuantity === null || newQuantity === null) return null;
  if (out[3] === into[3]) return null;

  const change: IsinChangeProposalInput = {
    kind: "isin-change",
    date,
    oldIsin: out[3],
    oldName: out[2],
    oldQuantity,
    newIsin: into[3],
    newName: into[2],
    newQuantity,
  };
  // Anything the registry would reject (e.g. an invalid check digit) still fails with the Corporate Action hint.
  return isinChangeProposalSchema.safeParse(change).success ? change : null;
}

/**
 * Claims a Baader corporate-action notice (a known title or a depot posting line). A readable ISIN change
 * (exactly one Ausbuchung and one Einbuchung on the same "per" date, two different ISINs, no cash or
 * remainder) becomes an ISIN-change proposal; anything else fails with the Corporate Action hint.
 */
export const parseFinanzenZeroCorporateAction: Parser = (text) => {
  if (!isBaaderDocument(text) || !(TITLE.test(text) || DEPOT_POSTING.test(text))) return { error: "unrecognized" };
  const isinChange = readIsinChange(text.replace(/\r\n?/g, "\n"));
  return isinChange ? { proposals: [], isinChange } : CORPORATE_ACTION;
};
