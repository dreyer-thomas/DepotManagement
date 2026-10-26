// The parser registry (AD-4): broker parsers per Broker, tried in order. `parseDocument` is the single
// decision point between a document's text and a parse outcome; `linkDocuments` (./link.ts) then merges
// outcomes across the files of one upload.
import type { Broker } from "@/modules/ledger";
import {
  type DocumentLink,
  type IsinChangeProposal,
  type Parser,
  parsedDocumentSchema,
  proposalListSchema,
  type TransactionProposal,
} from "../proposal";
import { parseComdirectDividend } from "./comdirect/dividend";
import { parseComdirectDividendTax } from "./comdirect/tax-notice";
import { parseComdirectTrade } from "./comdirect/trade";
import { parseDeutscheBankDividend } from "./deutsche-bank/dividend";
import { parseDeutscheBankTrade } from "./deutsche-bank/trade";
import { parseFinanzenZeroCorporateAction } from "./finanzen-zero/corporate-action";
import { parseFinanzenZeroDividend } from "./finanzen-zero/dividend";
import { parseFinanzenZeroTaxPot } from "./finanzen-zero/tax-pot";
import { parseFinanzenZeroTaxRefund } from "./finanzen-zero/tax-refund";
import { parseFinanzenZeroTrade } from "./finanzen-zero/trade";

/** One registered parser and the document type it reads (e.g. `"trade"`, `"dividend"`). */
export type ParserEntry = { documentType: string; parse: Parser };

/** Parsers per Broker, in the order they are tried. */
export type ParserRegistry = Record<Broker, readonly ParserEntry[]>;

/**
 * The production registry. Deutsche Bank / ROBIN reads settlements and dividend credits (story 5.2);
 * comdirect reads settlements (with their tax notice pages), dividend credits and dividend tax notices
 * (story 5.4); finanzen.net zero / Baader Bank reads corporate actions first (an ISIN change becomes a
 * proposal, story 5-6; any other notice fails), then settlements, dividends and fund distributions, tax
 * refunds and tax-pot notices that need no booking (story 5.5).
 */
export const PARSERS: ParserRegistry = {
  COMDIRECT: [
    { documentType: "trade", parse: parseComdirectTrade },
    { documentType: "dividend", parse: parseComdirectDividend },
    { documentType: "dividend-tax", parse: parseComdirectDividendTax },
  ],
  DEUTSCHE_BANK: [
    { documentType: "trade", parse: parseDeutscheBankTrade },
    { documentType: "dividend", parse: parseDeutscheBankDividend },
  ],
  FINANZEN_ZERO: [
    { documentType: "corporate-action", parse: parseFinanzenZeroCorporateAction },
    { documentType: "trade", parse: parseFinanzenZeroTrade },
    { documentType: "dividend", parse: parseFinanzenZeroDividend },
    { documentType: "tax-refund", parse: parseFinanzenZeroTaxRefund },
    { documentType: "tax-pot", parse: parseFinanzenZeroTaxPot },
  ],
};

/** Reason of a document no parser claims; also shown for an empty registry. */
export const UNRECOGNIZED_REASON = "Layout nicht erkannt. Buchung bitte manuell erfassen.";
/** Reason of a parser that threw. */
export const PARSER_CRASHED_REASON = "Dokument konnte nicht ausgewertet werden. Buchung bitte manuell erfassen.";
/** Reason of a parser result that is not valid AD-14 proposals. */
export const INVALID_OUTPUT_REASON = "Ausgelesene Buchung ist ungültig. Buchung bitte manuell erfassen.";
/** Reason of a parser that recognised the document but proposed nothing. */
export const NO_PROPOSALS_REASON = "Keine Buchung im Dokument gefunden. Buchung bitte manuell erfassen.";
/** Reason of a parser `invalid` error without a message. */
export const UNREADABLE_REASON = "Dokument erkannt, aber nicht lesbar. Buchung bitte manuell erfassen.";

/**
 * Outcome of one document: valid proposals with the document type (plus an optional review note and
 * link), a link without proposals (a tax notice awaiting `linkDocuments`), a document that needs no
 * booking (with its German info), an ISIN change of a corporate-action notice, or a German failure reason
 * (`corporateAction`: an unreadable corporate-action notice, never offered for manual Transaction entry).
 */
export type ParseOutcome =
  | { status: "PARSED"; documentType: string; proposals: TransactionProposal[]; note?: string; link?: DocumentLink }
  | { status: "LINK_ONLY"; documentType: string; link: DocumentLink }
  | { status: "NO_BOOKING"; documentType: string; reason: string }
  | { status: "CORPORATE_ACTION"; documentType: string; isinChange: IsinChangeProposal }
  | { status: "FAILED"; reason: string; corporateAction?: true };

function isParseError(value: unknown): value is { error: unknown; message?: unknown; corporateAction?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "error" in value;
}

/**
 * Runs the Broker's parsers on `text` in order; the first that does not return `{ error: "unrecognized" }`
 * decides. Its output is validated as a whole: a throw, an `invalid` error, invalid proposals or an empty
 * list fail the document — never partial proposals. Never logs the text or amounts.
 */
export function parseDocument(broker: Broker, text: string, registry: ParserRegistry = PARSERS): ParseOutcome {
  for (const entry of registry[broker] ?? []) {
    let result: unknown;
    try {
      result = entry.parse(text);
    } catch (error) {
      console.warn(`Import: parser ${entry.documentType} threw (${error instanceof Error ? error.name : "unknown"})`);
      return { status: "FAILED", reason: PARSER_CRASHED_REASON };
    }
    if (isParseError(result)) {
      if (result.error === "unrecognized") continue;
      if (result.error === "invalid") {
        const message = typeof result.message === "string" ? result.message.trim() : "";
        return {
          status: "FAILED",
          reason: message || UNREADABLE_REASON,
          ...(result.corporateAction === true ? { corporateAction: true as const } : {}),
        };
      }
      return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
    }
    const parsed = Array.isArray(result)
      ? proposalListSchema.safeParse(result).data
      : parsedDocumentSchema.safeParse(result).data;
    if (parsed === undefined) return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
    const { proposals, note, link, noBooking, isinChange } = Array.isArray(parsed)
      ? { proposals: parsed, note: undefined, link: undefined, noBooking: undefined, isinChange: undefined }
      : parsed;
    if (isinChange !== undefined) {
      // An ISIN change carries nothing else: proposals, a note, a link or an info next to it are invalid.
      if (proposals.length > 0 || note !== undefined || link !== undefined || noBooking !== undefined) {
        return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
      }
      return { status: "CORPORATE_ACTION", documentType: entry.documentType, isinChange };
    }
    if (noBooking !== undefined) {
      // A document needing no booking carries only its info; proposals, a link or a note next to it are invalid.
      if (proposals.length > 0 || link !== undefined || note !== undefined) return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
      return { status: "NO_BOOKING", documentType: entry.documentType, reason: noBooking };
    }
    if (link?.kind === "dividend-tax-notice") {
      // A tax notice carries only its link; proposals next to it are not a valid result.
      if (proposals.length > 0) return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
      return { status: "LINK_ONLY", documentType: entry.documentType, link };
    }
    if (proposals.length === 0) return { status: "FAILED", reason: NO_PROPOSALS_REASON };
    return {
      status: "PARSED",
      documentType: entry.documentType,
      proposals,
      ...(note !== undefined ? { note } : {}),
      ...(link !== undefined ? { link } : {}),
    };
  }
  return { status: "FAILED", reason: UNRECOGNIZED_REASON };
}
