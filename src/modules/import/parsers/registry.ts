// The parser registry (AD-4): broker parsers per Broker, tried in order. `parseDocument` is the single
// decision point between a document's text and a parse outcome; `linkDocuments` (./link.ts) then merges
// outcomes across the files of one upload.
import type { Broker } from "@/modules/ledger";
import { type DocumentLink, type Parser, parsedDocumentSchema, proposalListSchema, type TransactionProposal } from "../proposal";
import { parseComdirectDividend } from "./comdirect/dividend";
import { parseComdirectDividendTax } from "./comdirect/tax-notice";
import { parseComdirectTrade } from "./comdirect/trade";
import { parseDeutscheBankDividend } from "./deutsche-bank/dividend";
import { parseDeutscheBankTrade } from "./deutsche-bank/trade";

/** One registered parser and the document type it reads (e.g. `"trade"`, `"dividend"`). */
export type ParserEntry = { documentType: string; parse: Parser };

/** Parsers per Broker, in the order they are tried. */
export type ParserRegistry = Record<Broker, readonly ParserEntry[]>;

/**
 * The production registry. Deutsche Bank / ROBIN reads settlements and dividend credits (story 5.2);
 * comdirect reads settlements (with their tax notice pages), dividend credits and dividend tax notices
 * (story 5.4); finanzen.net zero stays manual: its documents are unrecognized.
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
  FINANZEN_ZERO: [],
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
 * link), a link without proposals (a tax notice awaiting `linkDocuments`), or a German failure reason.
 */
export type ParseOutcome =
  | { status: "PARSED"; documentType: string; proposals: TransactionProposal[]; note?: string; link?: DocumentLink }
  | { status: "LINK_ONLY"; documentType: string; link: DocumentLink }
  | { status: "FAILED"; reason: string };

function isParseError(value: unknown): value is { error: unknown; message?: unknown } {
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
        return { status: "FAILED", reason: message || UNREADABLE_REASON };
      }
      return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
    }
    const parsed = Array.isArray(result)
      ? proposalListSchema.safeParse(result).data
      : parsedDocumentSchema.safeParse(result).data;
    if (parsed === undefined) return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
    const { proposals, note, link } = Array.isArray(parsed) ? { proposals: parsed, note: undefined, link: undefined } : parsed;
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
