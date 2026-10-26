import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Parser } from "../proposal";
import {
  INVALID_OUTPUT_REASON,
  NO_PROPOSALS_REASON,
  PARSER_CRASHED_REASON,
  PARSERS,
  parseDocument,
  type ParserRegistry,
  UNREADABLE_REASON,
  UNRECOGNIZED_REASON,
} from "./registry";

const BUY = { type: "BUY", date: "2026-10-08", isin: "DE0007164600", quantity: "2", price: "10.5", amount: "21" } as const;

const unrecognized: Parser = () => ({ error: "unrecognized" });
const stub: Parser = (text) => (text.includes("Kauf") ? [BUY] : { error: "unrecognized" });

function registry(entries: ParserRegistry["DEUTSCHE_BANK"]): ParserRegistry {
  return { COMDIRECT: [], DEUTSCHE_BANK: entries, FINANZEN_ZERO: [] };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseDocument", () => {
  it("registers the Deutsche Bank and comdirect parsers; other documents stay unrecognized", () => {
    expect(PARSERS.DEUTSCHE_BANK.map((entry) => entry.documentType)).toEqual(["trade", "dividend"]);
    expect(PARSERS.COMDIRECT.map((entry) => entry.documentType)).toEqual(["trade", "dividend", "dividend-tax"]);
    expect(PARSERS.FINANZEN_ZERO).toEqual([]);
    expect(parseDocument("DEUTSCHE_BANK", "Kauf")).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
    expect(parseDocument("COMDIRECT", "Abrechnung: Kauf von Wertpapieren")).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
    expect(parseDocument("FINANZEN_ZERO", "Wertpapierkauf GESCHÄFTSABRECHNUNG")).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
    expect(UNRECOGNIZED_REASON).toBe("Layout nicht erkannt. Buchung bitte manuell erfassen.");
  });

  it("returns the validated proposals and the document type of a stub parser", () => {
    expect(parseDocument("DEUTSCHE_BANK", "Kauf", registry([{ documentType: "trade", parse: stub }]))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [{ ...BUY, fee: "0", tax: "0" }],
    });
  });

  it("fails with the layout message when no parser claims the text", () => {
    const result = parseDocument("DEUTSCHE_BANK", "Kontoauszug", registry([{ documentType: "trade", parse: stub }]));
    expect(result).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
  });

  it("only uses the Depot's Broker's parsers", () => {
    expect(parseDocument("COMDIRECT", "Kauf", registry([{ documentType: "trade", parse: stub }]))).toEqual({
      status: "FAILED",
      reason: UNRECOGNIZED_REASON,
    });
  });

  it("lets the first parser that does not return unrecognized decide", () => {
    const later = vi.fn<Parser>(() => [BUY]);
    const entries = [
      { documentType: "dividend", parse: unrecognized },
      { documentType: "trade", parse: stub },
      { documentType: "other", parse: later },
    ];
    expect(parseDocument("DEUTSCHE_BANK", "Kauf", registry(entries))).toMatchObject({ status: "PARSED", documentType: "trade" });
    expect(later).not.toHaveBeenCalled();
  });

  it("fails with the parser's message for an invalid error and does not try further parsers", () => {
    const later = vi.fn<Parser>(() => [BUY]);
    const entries = [
      { documentType: "trade", parse: (() => ({ error: "invalid", message: "Stückzahl fehlt." })) as Parser },
      { documentType: "other", parse: later },
    ];
    expect(parseDocument("DEUTSCHE_BANK", "x", registry(entries))).toEqual({ status: "FAILED", reason: "Stückzahl fehlt." });
    expect(later).not.toHaveBeenCalled();
    const blank: Parser = () => ({ error: "invalid", message: " " });
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "t", parse: blank }]))).toEqual({
      status: "FAILED",
      reason: UNREADABLE_REASON,
    });
  });

  it("fails the whole document when one proposal is invalid (never partial proposals)", () => {
    const partly: Parser = () => [BUY, { ...BUY, amount: "-1" }];
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "trade", parse: partly }]))).toEqual({
      status: "FAILED",
      reason: INVALID_OUTPUT_REASON,
    });
  });

  it.each([
    ["not an array", () => "BUY"],
    ["an unknown error", () => ({ error: "boom" })],
    ["null", () => null],
  ])("fails for output that is %s", (_label, parse) => {
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "t", parse: parse as unknown as Parser }]))).toEqual({
      status: "FAILED",
      reason: INVALID_OUTPUT_REASON,
    });
  });

  it("fails when the parser throws, logging only the error name", () => {
    const thrower: Parser = () => {
      throw new RangeError("secret 1.482,36 €");
    };
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "trade", parse: thrower }]))).toEqual({
      status: "FAILED",
      reason: PARSER_CRASHED_REASON,
    });
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).not.toContain("1.482");
  });

  it("passes a parsed document's note and link through", () => {
    const link = { kind: "dividend-credit", reference: "R1", beforeTax: "21.00" } as const;
    const doc: Parser = () => ({ proposals: [BUY], note: "Bitte prüfen.", link });
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "dividend", parse: doc }]))).toEqual({
      status: "PARSED",
      documentType: "dividend",
      proposals: [{ ...BUY, fee: "0", tax: "0" }],
      note: "Bitte prüfen.",
      link: { ...link, beforeTax: "21" },
    });
  });

  it("returns a tax-notice link without proposals as LINK_ONLY", () => {
    const link = { kind: "dividend-tax-notice", reference: "R1", isin: "DE0007164600", beforeTax: "10", afterTax: "7.5" } as const;
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "tax", parse: () => ({ proposals: [], link }) }]))).toEqual({
      status: "LINK_ONLY",
      documentType: "tax",
      link,
    });
    const withProposals: Parser = () => ({ proposals: [BUY], link });
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "tax", parse: withProposals }]))).toEqual({
      status: "FAILED",
      reason: INVALID_OUTPUT_REASON,
    });
  });

  it("fails a parsed document without proposals and without tax-notice link, or with an invalid shape", () => {
    const empty: Parser = () => ({ proposals: [], note: "x" });
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "t", parse: empty }]))).toEqual({
      status: "FAILED",
      reason: NO_PROPOSALS_REASON,
    });
    const badLink = (() => ({ proposals: [BUY], link: { kind: "other" } })) as unknown as Parser;
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "t", parse: badLink }]))).toEqual({
      status: "FAILED",
      reason: INVALID_OUTPUT_REASON,
    });
  });

  it("fails when the parser proposes nothing", () => {
    expect(parseDocument("DEUTSCHE_BANK", "x", registry([{ documentType: "trade", parse: () => [] }]))).toEqual({
      status: "FAILED",
      reason: NO_PROPOSALS_REASON,
    });
  });
});
