import { describe, expect, it } from "vitest";
import {
  bookableCorrection,
  carryDecisions,
  type Correction,
  correctionDraft,
  decisionsSchema,
  EMPTY_DECISIONS,
  initialDecisions,
  itemKey,
  type MigrationDecisions,
  openDecisions,
  parqetAsIsDecisions,
  submittedDecisions,
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

const security = (key: string, assetType: "ETF" | "STOCK" | "CRYPTO", existing = false) => ({
  key,
  isin: assetType === "CRYPTO" ? null : key,
  cryptoSymbol: assetType === "CRYPTO" ? key : null,
  name: key,
  assetType,
  existing,
  estimated: !existing && assetType !== "CRYPTO",
});

const PREVIEW: Pick<ParqetPreview, "securities" | "flagged" | "duplicates"> = {
  securities: [security("A", "STOCK"), security("B", "ETF", true), security("C", "CRYPTO"), security("D", "STOCK", true)],
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
  it("keys items by their records; a delivery's DEPOSIT gets a trailing d", () => {
    expect(itemKey({ records: [4, 5] })).toBe("4-5");
    expect(itemKey({ records: [7] })).toBe("7");
    expect(itemKey({ records: [7], delivery: "buy" })).toBe("7");
    expect(itemKey({ records: [7], delivery: "deposit" })).toBe("7d");
  });

  it("lists only undecided duplicates as open: classifications and flags never block", () => {
    expect(openDecisions(PREVIEW, EMPTY_DECISIONS)).toEqual([{ kind: "duplicate", key: "9" }]);
    expect(openDecisions(PREVIEW, { ...EMPTY_DECISIONS, duplicates: { 9: "book" } })).toEqual([]);
    expect(openDecisions({ duplicates: [] }, EMPTY_DECISIONS)).toEqual([]);
  });

  it("pre-sets duplicates to skip", () => {
    const initial = initialDecisions(PREVIEW);
    expect(initial).toEqual({ classifications: {}, flags: {}, duplicates: { 9: "skip" } });
    expect(openDecisions(PREVIEW, initial)).toEqual([]);
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
    expect(decisionsSchema.safeParse({ classifications: { A: "FUND" }, flags: {}, duplicates: {} }).success).toBe(true);
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

  describe("bookableCorrection", () => {
    const KEYS = new Set(["US0378331005", "BTC"]);
    const buyRow = raw({
      datetime: "2024-07-04T10:00:00.000Z",
      type: "Buy",
      assettype: "Security",
      identifier: "US0378331005",
      shares: "10",
      price: "9,9",
      amount: "99",
      fee: "1",
      tax: "0",
    });
    const check = (rows: RawRow[], change: Partial<Correction> = {}) => {
      const flag = { rows };
      return bookableCorrection(flag, { ...correctionDraft(flag), ...change }, KEYS);
    };

    it("accepts an EUR draft whose figures satisfy the ledger and whose Security is in the preview", () => {
      expect(check([buyRow])).toBe(true);
      expect(check([buyRow], { amount: "" })).toBe(true);
      expect(check([raw({ datetime: "2024-07-04T10:00:00.000Z", type: "TransferIn", assettype: "Cash", amount: "5" })])).toBe(true);
      expect(check([raw({ datetime: "2024-07-04T10:00:00.000Z", type: "cost", assettype: "Cash", tax: "-1,5" })])).toBe(true);
      expect(check([raw({ datetime: "2024-07-04T10:00:00.000Z", type: "Dividend", assettype: "Security", identifier: "US0378331005", amount: "3" })])).toBe(true);
    });

    it.each<[string, RawRow[], Partial<Correction>]>([
      ["a non-EUR row", [buyRow, raw({ ...buyRow, currency: "USD" })], {}],
      ["an empty currency", [raw({ ...buyRow, currency: "" })], {}],
      ["a garbage date", [raw({ ...buyRow, datetime: "garbage" })], {}],
      ["no rows", [], {}],
      ["a zero quantity", [buyRow], { quantity: "0" }],
      ["a quantity with 9 decimals", [buyRow], { quantity: "0,123456789" }],
      ["an unparseable price", [buyRow], { price: "abc" }],
      ["a missing price", [buyRow], { price: "" }],
      ["a negative amount", [buyRow], { amount: "-1" }],
      ["a negative fee", [buyRow], { fee: "-1" }],
      ["an unparseable tax", [buyRow], { tax: "x" }],
      ["a Security outside the preview", [buyRow], { securityKey: "DE0007164600" }],
      ["a DIVIDEND without amount", [buyRow], { type: "DIVIDEND", amount: "" }],
      ["a DEPOSIT of 0", [buyRow], { type: "DEPOSIT", amount: "0" }],
      ["a TAX of 0", [buyRow], { type: "TAX", tax: "0" }],
      ["a TAX on an unknown Security", [buyRow], { type: "TAX", tax: "1", securityKey: "XX" }],
    ])("refuses %s", (_label, rows, change) => {
      expect(check(rows, change)).toBe(false);
    });
  });

  it("decides every flag as-is: bookable drafts booked, the rest skipped, other decisions kept", () => {
    const preview: Pick<ParqetPreview, "securities" | "flagged"> = {
      securities: [security("US0378331005", "STOCK")],
      flagged: [
        {
          records: [4],
          reason: "unpaired-security-transfer",
          rows: [
            raw({
              datetime: "2024-07-04T10:00:00.000Z",
              type: "TransferOut",
              assettype: "Security",
              identifier: "US0378331005",
              shares: "2",
              price: "0",
              amount: "0",
            }),
          ],
        },
        { records: [8], reason: "non-eur", detail: "USD", rows: [raw({ datetime: "2024-07-01T09:00:00.000Z", type: "Buy", currency: "USD" })] },
      ],
    };
    const decisions: MigrationDecisions = { classifications: { US0378331005: "ETF" }, flags: { 8: { action: "skip" } }, duplicates: { 9: "book" } };
    const asIs = parqetAsIsDecisions(preview, decisions);
    expect(asIs.classifications).toEqual(decisions.classifications);
    expect(asIs.duplicates).toEqual(decisions.duplicates);
    expect(asIs.flags).toEqual({
      4: { action: "book", correction: correctionDraft(preview.flagged[0]) },
      8: { action: "skip" },
    });
    expect(asIs.flags[4]).toMatchObject({ correction: { type: "SELL", quantity: "2", date: "2024-07-04" } });
  });

  it("skips an unsupported-split flag as-is: its draft would book only one of the two legs", () => {
    const leg = (type: string, shares: string) =>
      raw({ datetime: "2024-07-04T10:00:00.000Z", type, assettype: "Security", identifier: "US0378331005", shares, price: "0", amount: "0" });
    const preview: Pick<ParqetPreview, "securities" | "flagged"> = {
      securities: [security("US0378331005", "STOCK")],
      flagged: [{ records: [2, 3], reason: "unsupported-split", rows: [leg("TransferOut", "3"), leg("TransferIn", "3")] }],
    };
    expect(parqetAsIsDecisions(preview, EMPTY_DECISIONS).flags).toEqual({ "2-3": { action: "skip" } });
  });

  it("submits the as-is decisions only for 'Alle wie in Parqet übernehmen'", () => {
    const preview: Pick<ParqetPreview, "securities" | "flagged"> = {
      securities: [],
      flagged: [{ records: [8], reason: "non-eur", detail: "USD", rows: [raw({ currency: "USD" })] }],
    };
    const decisions: MigrationDecisions = { ...EMPTY_DECISIONS, duplicates: { 9: "book" } };
    expect(submittedDecisions(preview, decisions, false)).toBe(decisions);
    expect(submittedDecisions(preview, decisions, true)).toEqual({ ...decisions, flags: { 8: { action: "skip" } } });
  });
});
