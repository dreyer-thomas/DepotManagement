import { describe, expect, it } from "vitest";
import {
  carryDecisions,
  correctionDraft,
  decisionsSchema,
  EMPTY_DECISIONS,
  initialDecisions,
  itemKey,
  type MigrationDecisions,
  openDecisions,
} from "./decisions";
import type { RawRow } from "./parqet-reader";
import type { ParqetPreview } from "./preview";

const raw = (row: Partial<RawRow>): RawRow => ({
  datetime: "",
  type: "",
  assettype: "",
  identifier: "",
  holdingname: "",
  shares: "",
  price: "",
  amount: "",
  fee: "",
  tax: "",
  currency: "EUR",
  ...row,
});

const security = (key: string, assetType: "UNCLASSIFIED" | "STOCK" | "CRYPTO", existing = false) => ({
  key,
  isin: key,
  cryptoSymbol: null,
  name: key,
  assetType,
  existing,
});

const PREVIEW: Pick<ParqetPreview, "securities" | "flagged" | "duplicates"> = {
  securities: [security("A", "UNCLASSIFIED"), security("B", "UNCLASSIFIED", true), security("C", "CRYPTO"), security("D", "STOCK", true)],
  flagged: [{ records: [4, 5], reason: "cash-pair-mismatch", rows: [] }],
  duplicates: [
    {
      key: "9",
      status: "duplicate",
      matches: [],
      proposal: {
        type: "DEPOSIT",
        date: "2024-01-01",
        sequence: 1,
        securityKey: null,
        quantity: null,
        price: null,
        amount: "1",
        fee: "0",
        tax: "0",
        realizedGain: null,
        records: [9],
      },
    },
  ],
};

describe("decisions", () => {
  it("keys items by their records", () => {
    expect(itemKey({ records: [4, 5] })).toBe("4-5");
    expect(itemKey({ records: [7] })).toBe("7");
  });

  it("lists open decisions: new UNCLASSIFIED Securities, undecided flags and duplicates", () => {
    expect(openDecisions(PREVIEW, EMPTY_DECISIONS)).toEqual([
      { kind: "classification", key: "A" },
      { kind: "flag", key: "4-5" },
      { kind: "duplicate", key: "9" },
    ]);
    const decided: MigrationDecisions = {
      classifications: { A: "ETF" },
      flags: { "4-5": { action: "skip" } },
      duplicates: { 9: "book" },
    };
    expect(openDecisions(PREVIEW, decided)).toEqual([]);
  });

  it("pre-sets duplicates to skip", () => {
    const initial = initialDecisions(PREVIEW);
    expect(initial).toEqual({ classifications: {}, flags: {}, duplicates: { 9: "skip" } });
    expect(openDecisions(PREVIEW, initial)).toHaveLength(2);
  });

  it("carries decisions whose keys still exist", () => {
    const previous: MigrationDecisions = {
      classifications: { A: "STOCK", Z: "ETF" },
      flags: { "4-5": { action: "skip" }, "1-2": { action: "skip" } },
      duplicates: { 9: "book", 3: "book" },
    };
    expect(carryDecisions(PREVIEW, previous)).toEqual({
      classifications: { A: "STOCK" },
      flags: { "4-5": { action: "skip" } },
      duplicates: { 9: "book" },
    });
    // A new duplicate starts as skip.
    expect(carryDecisions(PREVIEW, EMPTY_DECISIONS).duplicates).toEqual({ 9: "skip" });
  });

  it("validates decisions with zod", () => {
    expect(decisionsSchema.safeParse({ classifications: {}, flags: {}, duplicates: {} }).success).toBe(true);
    expect(decisionsSchema.safeParse({ classifications: { A: "CRYPTO" }, flags: {}, duplicates: {} }).success).toBe(false);
    expect(decisionsSchema.safeParse({ classifications: {}, flags: { 1: { action: "book" } }, duplicates: {} }).success).toBe(false);
    expect(decisionsSchema.safeParse(null).success).toBe(false);
  });

  it("drafts a correction from the Security row of a flag", () => {
    const draft = correctionDraft({
      rows: [
        raw({ datetime: "2024-07-04T10:00:00.000Z", type: "TransferOut", assettype: "Cash", amount: "90" }),
        raw({
          datetime: "2024-07-04T10:00:00.000Z",
          type: "Buy",
          assettype: "Security",
          identifier: "us0378331005",
          holdingname: "Apfel",
          shares: "10",
          price: "9,9",
          amount: "99",
          fee: "1",
          tax: "-0,5",
        }),
      ],
    });
    expect(draft).toEqual({
      type: "BUY",
      date: "2024-07-04",
      securityKey: "US0378331005",
      securityName: "Apfel",
      assetType: "",
      quantity: "10",
      price: "9,9",
      amount: "99",
      fee: "1",
      tax: "-0,5",
    });
  });

  it.each([
    [{ type: "TransferIn", assettype: "Security" }, "BUY"],
    [{ type: "TransferOut", assettype: "Security" }, "SELL"],
    [{ type: "TransferIn", assettype: "Cash" }, "DEPOSIT"],
    [{ type: "TransferOut", assettype: "Cash" }, "WITHDRAWAL"],
    [{ type: "cost", assettype: "Security" }, "TAX"],
    [{ type: "Dividend", assettype: "Security" }, "DIVIDEND"],
    [{ type: "Sell", assettype: "Crypto" }, "SELL"],
    [{ type: "Weird", assettype: "Cash" }, "DEPOSIT"],
  ] as const)("maps %j to %s", (row, type) => {
    expect(correctionDraft({ rows: [raw(row)] }).type).toBe(type);
  });

  it("converts the datetime to the Berlin business date, drops minus signs and marks crypto", () => {
    const draft = correctionDraft({
      rows: [raw({ datetime: "2024-03-31T22:30:00.000Z", type: "Buy", assettype: "Crypto", identifier: "btc", shares: "-1", amount: "-5" })],
    });
    expect(draft).toMatchObject({ date: "2024-04-01", securityKey: "BTC", assetType: "CRYPTO", quantity: "1", amount: "5" });
    expect(correctionDraft({ rows: [raw({ datetime: "garbage", type: "TransferIn", assettype: "Cash", amount: "5" })] })).toMatchObject({
      date: "",
      securityKey: "",
      amount: "5",
    });
    expect(correctionDraft({ rows: [] }).type).toBe("BUY");
  });
});
