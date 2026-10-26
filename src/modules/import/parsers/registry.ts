// The parser registry (AD-4): broker parsers per Broker, tried in order. `parseDocument` is the single
// decision point between a document's text and an item status. Story 5.4 adds the comdirect parsers.
import type { Broker } from "@/modules/ledger";
import { type Parser, proposalListSchema, type TransactionProposal } from "../proposal";
import { parseDeutscheBankDividend } from "./deutsche-bank/dividend";
import { parseDeutscheBankTrade } from "./deutsche-bank/trade";

/** One registered parser and the document type it reads (e.g. `"trade"`, `"dividend"`). */
export type ParserEntry = { documentType: string; parse: Parser };

/** Parsers per Broker, in the order they are tried. */
export type ParserRegistry = Record<Broker, readonly ParserEntry[]>;

/**
 * The production registry. Deutsche Bank / ROBIN reads settlements and dividend credits (story 5.2);
 * comdirect follows in story 5.4 and finanzen.net zero stays manual: their documents are unrecognized.
 */
export const PARSERS: ParserRegistry = {
  COMDIRECT: [],
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

/** Outcome of one document: valid proposals with the document type, or a German failure reason. */
export type ParseOutcome =
  | { status: "PARSED"; documentType: string; proposals: TransactionProposal[] }
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
    const parsed = proposalListSchema.safeParse(result);
    if (!parsed.success) return { status: "FAILED", reason: INVALID_OUTPUT_REASON };
    if (parsed.data.length === 0) return { status: "FAILED", reason: NO_PROPOSALS_REASON };
    return { status: "PARSED", documentType: entry.documentType, proposals: parsed.data };
  }
  return { status: "FAILED", reason: UNRECOGNIZED_REASON };
}
