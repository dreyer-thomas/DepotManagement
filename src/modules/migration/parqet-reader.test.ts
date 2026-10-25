import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cashEffect } from "@/core/cash";
import { type ParqetReadResult, readParqetCsv } from "./parqet-reader";

const FIXTURE = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");

const HEADER = "datetime;price;shares;amount;tax;fee;realizedgains;type;assettype;identifier;currency;holdingname";

type Row = Partial<{
  datetime: string;
  price: string;
  shares: string;
  amount: string;
  tax: string;
  fee: string;
  realizedgains: string;
  type: string;
  assettype: string;
  identifier: string;
  currency: string;
  holdingname: string;
}>;

const AAPL = "US0378331005";
const T = "2024-05-06T09:00:00.000Z";

function csv(...rows: Row[]): string {
  const lines = rows.map((row) =>
    [
      row.datetime ?? T,
      row.price ?? "",
      row.shares ?? "",
      row.amount ?? "",
      row.tax ?? "",
      row.fee ?? "",
      row.realizedgains ?? "",
      row.type ?? "",
      row.assettype ?? "Security",
      row.identifier ?? "",
      row.currency ?? "EUR",
      row.holdingname ?? "",
    ].join(";"),
  );
  return [HEADER, ...lines].join("\n");
}

const cash = (type: "TransferIn" | "TransferOut", amount: string, datetime = T): Row => ({
  datetime,
  type,
  assettype: "Cash",
  amount,
});

function ok(result: ParqetReadResult) {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

describe("readParqetCsv — synthetic fixture", () => {
  const result = ok(readParqetCsv(FIXTURE));

  it("emits proposals oldest first with chronological sequences, collapsing cash pairs", () => {
    expect(result.proposals).toEqual([
      {
        type: "DEPOSIT",
        date: "2024-01-02",
        sequence: 1,
        securityKey: null,
        quantity: null,
        price: null,
        amount: "10000",
        fee: "0",
        tax: "0",
        realizedGain: null,
        records: [24],
      },
      {
        type: "BUY",
        date: "2024-01-10",
        sequence: 2,
        securityKey: AAPL,
        quantity: "10",
        price: "12.3456",
        amount: "123.46",
        fee: "1",
        tax: "0",
        realizedGain: null,
        originalAmount: "123.456",
        records: [22, 23],
      },
      {
        type: "BUY",
        date: "2024-02-01",
        sequence: 3,
        securityKey: "BTC",
        quantity: "0.00012345",
        price: "40000",
        amount: "4.938",
        fee: "0",
        tax: "0",
        realizedGain: null,
        records: [20, 21],
      },
      {
        type: "DIVIDEND",
        date: "2024-03-01",
        sequence: 4,
        securityKey: AAPL,
        quantity: null,
        price: null,
        amount: "30",
        fee: "0",
        tax: "4.5",
        realizedGain: null,
        records: [18, 19],
      },
      {
        type: "TAX",
        date: "2024-04-01",
        sequence: 5,
        securityKey: AAPL,
        quantity: null,
        price: null,
        amount: "0",
        fee: "0",
        tax: "3.1",
        realizedGain: null,
        records: [16, 17],
      },
      {
        type: "BUY",
        date: "2024-04-15",
        sequence: 6,
        securityKey: "DE0007164600",
        quantity: "12.00345678",
        price: "100",
        amount: "1200.345678",
        fee: "0.99",
        tax: "0",
        realizedGain: null,
        records: [14, 15],
      },
      {
        type: "SELL",
        date: "2024-06-03",
        sequence: 7,
        securityKey: AAPL,
        quantity: "5",
        price: "100",
        amount: "500",
        fee: "1",
        tax: "-2",
        realizedGain: "438.77",
        records: [10, 11],
      },
      {
        type: "WITHDRAWAL",
        date: "2024-06-10",
        sequence: 8,
        securityKey: null,
        quantity: null,
        price: null,
        amount: "50",
        fee: "0",
        tax: "0",
        realizedGain: null,
        records: [9],
      },
    ]);
  });

  it("detects the ISIN change", () => {
    expect(result.isinChanges).toEqual([
      {
        date: "2024-05-02",
        oldKey: "DE0007164600",
        newKey: "DE000SYN0013",
        oldQuantity: "12.00345678",
        newQuantity: "6.00172839",
        records: [12, 13],
      },
    ]);
  });

  it("flags every row that must not be booked, with record numbers", () => {
    expect(result.flagged).toEqual([
      { records: [2], reason: "unsupported-row", detail: "Buy/Cash" },
      { records: [3], reason: "unparseable", detail: "datetime" },
      { records: [4, 5], reason: "cash-pair-mismatch" },
      { records: [6], reason: "unpaired-security-transfer" },
      { records: [7], reason: "unparseable", detail: "shares" },
      { records: [8], reason: "non-eur", detail: "USD" },
    ]);
  });

  it("lists the Securities with the newest name and proposed types", () => {
    expect(result.securities).toEqual([
      { key: "BTC", isin: null, cryptoSymbol: "BTC", name: "Bitcoin", proposedAssetType: "CRYPTO" },
      { key: "DE0007164600", isin: "DE0007164600", cryptoSymbol: null, name: "Altname Software SE", proposedAssetType: "UNCLASSIFIED" },
      { key: "DE000SYN0013", isin: "DE000SYN0013", cryptoSymbol: null, name: "Neuname Software SE", proposedAssetType: "UNCLASSIFIED" },
      { key: AAPL, isin: AAPL, cryptoSymbol: null, name: 'Apfel "Tech" Inc.; Class A', proposedAssetType: "UNCLASSIFIED" },
    ]);
  });

  it("takes the latest proposal date as export date", () => {
    expect(result.exportDate).toBe("2024-06-10");
  });
});

describe("readParqetCsv — mapping rules", () => {
  it("aligns a Buy to its cash row and keeps the original amount", () => {
    const { proposals } = ok(
      readParqetCsv(
        csv({ type: "Buy", identifier: AAPL, shares: "10", price: "12,3456", amount: "123,456", fee: "1", tax: "0" }, cash("TransferOut", "124,46")),
      ),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: "BUY", amount: "123.46", originalAmount: "123.456", records: [2, 3] });
  });

  it("keeps a negative tax on a Sell (refund) and pairs with TransferIn", () => {
    const { proposals } = ok(
      readParqetCsv(
        csv({ type: "Sell", identifier: AAPL, shares: "5", price: "100", amount: "500", fee: "1", tax: "-2" }, cash("TransferIn", "501")),
      ),
    );
    expect(proposals).toEqual([expect.objectContaining({ type: "SELL", amount: "500", fee: "1", tax: "-2", records: [2, 3] })]);
    expect(proposals[0].originalAmount).toBeUndefined();
  });

  it("books a Dividend from amount, never price × shares, without quantity", () => {
    const { proposals } = ok(
      readParqetCsv(
        csv({ type: "Dividend", identifier: AAPL, shares: "1", price: "30", amount: "30", tax: "4,5" }, cash("TransferIn", "25,5")),
      ),
    );
    expect(proposals).toEqual([
      expect.objectContaining({ type: "DIVIDEND", amount: "30", tax: "4.5", fee: "0", quantity: null, price: null, records: [2, 3] }),
    ]);
  });

  it("turns a tax-only cost row into TAX; other cost rows are unsupported", () => {
    const result = ok(
      readParqetCsv(
        csv(
          { type: "cost", identifier: AAPL, amount: "0", tax: "3,1" },
          cash("TransferOut", "3,1"),
          { datetime: "2024-05-07T09:00:00.000Z", type: "cost", assettype: "Cash", amount: "5", tax: "0" },
        ),
      ),
    );
    expect(result.proposals).toEqual([
      expect.objectContaining({ type: "TAX", securityKey: AAPL, amount: "0", fee: "0", tax: "3.1", records: [2, 3] }),
    ]);
    expect(result.flagged).toEqual([{ records: [4], reason: "unsupported-row", detail: "cost/Cash" }]);
  });

  it("aligns a TAX's tax to its cash row", () => {
    const { proposals } = ok(readParqetCsv(csv({ type: "cost", assettype: "Cash", amount: "0", tax: "3,104" }, cash("TransferOut", "3,1"))));
    expect(proposals).toEqual([expect.objectContaining({ type: "TAX", securityKey: null, tax: "3.1", originalTax: "3.104" })]);
  });

  it("maps unpaired cash rows to DEPOSIT and WITHDRAWAL", () => {
    const { proposals } = ok(
      readParqetCsv(csv(cash("TransferIn", "1.000,00", "2024-01-01T00:00:00.000Z"), cash("TransferOut", "-50", "2024-01-02T00:00:00.000Z"))),
    );
    expect(proposals.map((p) => [p.type, p.amount, p.securityKey])).toEqual([
      ["DEPOSIT", "1000", null],
      ["WITHDRAWAL", "50", null],
    ]);
  });

  it("keeps a trade without a same-datetime cash row unpaired (export without cash rows)", () => {
    const { proposals, flagged } = ok(
      readParqetCsv(
        csv(
          { type: "Buy", identifier: AAPL, shares: "1", price: "10", amount: "10" },
          cash("TransferOut", "10", "2024-05-06T09:00:01.000Z"),
        ),
      ),
    );
    expect(flagged).toEqual([]);
    expect(proposals.map((p) => [p.type, p.records])).toEqual([
      ["BUY", [2]],
      ["WITHDRAWAL", [3]],
    ]);
  });

  it("flags a trade and its same-datetime cash row that differ by more than €0.01", () => {
    const result = ok(
      readParqetCsv(csv({ type: "Buy", identifier: AAPL, shares: "10", price: "9,9", amount: "99", fee: "1" }, cash("TransferOut", "90"))),
    );
    expect(result.proposals).toEqual([]);
    expect(result.flagged).toEqual([{ records: [2, 3], reason: "cash-pair-mismatch" }]);
  });

  it("pairs each trade with the closest cash row of the same datetime and direction", () => {
    const { proposals } = ok(
      readParqetCsv(
        csv(
          cash("TransferOut", "20"),
          { type: "Buy", identifier: AAPL, shares: "1", price: "10", amount: "10" },
          cash("TransferOut", "10"),
          { type: "Buy", identifier: AAPL, shares: "2", price: "10", amount: "20" },
        ),
      ),
    );
    expect(proposals.map((p) => [p.quantity, p.records])).toEqual([
      ["2", [2, 5]],
      ["1", [3, 4]],
    ]);
  });

  it("turns a same-datetime TransferOut/TransferIn pair into an ISIN change", () => {
    const result = ok(
      readParqetCsv(
        csv(
          { type: "TransferIn", identifier: "DE000SYN0013", shares: "5" },
          { type: "TransferOut", identifier: AAPL, shares: "10", price: "0" },
        ),
      ),
    );
    expect(result.isinChanges).toEqual([
      { date: "2024-05-06", oldKey: AAPL, newKey: "DE000SYN0013", oldQuantity: "10", newQuantity: "5", records: [2, 3] },
    ]);
    expect(result.proposals).toEqual([]);
    expect(result.flagged).toEqual([]);
    expect(result.exportDate).toBe("2024-05-06");
  });

  it.each([
    ["a lone TransferIn", [{ type: "TransferIn", identifier: AAPL, shares: "3" }], [2]],
    [
      "two TransferIns",
      [
        { type: "TransferIn", identifier: AAPL, shares: "3" },
        { type: "TransferIn", identifier: "DE000SYN0013", shares: "3" },
      ],
      [2, 3],
    ],
    [
      "a pair of the same Security",
      [
        { type: "TransferOut", identifier: AAPL, shares: "3" },
        { type: "TransferIn", identifier: AAPL, shares: "3" },
      ],
      [2, 3],
    ],
  ] as [string, Row[], number[]][])("flags %s as unpaired-security-transfer", (_label, rows, records) => {
    const result = ok(readParqetCsv(csv(...rows)));
    expect(result.isinChanges).toEqual([]);
    expect(result.flagged).toEqual([{ records, reason: "unpaired-security-transfer" }]);
  });

  it.each([
    ["USD", "USD"],
    ["", ""],
  ])("flags currency %j as non-eur", (currency, detail) => {
    const result = ok(readParqetCsv(csv({ type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1", currency })));
    expect(result.flagged).toEqual([{ records: [2], reason: "non-eur", detail }]);
  });

  it("accepts eur in any case", () => {
    const result = ok(readParqetCsv(csv({ type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1", currency: "eur" })));
    expect(result.flagged).toEqual([]);
    expect(result.proposals).toHaveLength(1);
  });

  it.each<[string, Row, string | undefined]>([
    ["a garbage datetime", { datetime: "garbage", type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1" }, "datetime"],
    ["non-numeric shares", { type: "Buy", identifier: AAPL, shares: "abc", price: "1", amount: "1" }, "shares"],
    ["shares with 9 decimals", { type: "Buy", identifier: AAPL, shares: "0,123456789", price: "1", amount: "1" }, "shares"],
    ["a bad amount", { type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1,2,3" }, "amount"],
    ["a missing amount", { type: "Dividend", identifier: AAPL }, "amount"],
    ["an invalid ISIN check digit", { type: "Buy", identifier: "US0378331006", shares: "1", price: "1", amount: "1" }, "identifier"],
    ["a missing identifier", { type: "Buy", identifier: "", shares: "1", price: "1", amount: "1" }, "identifier"],
    ["an invalid crypto symbol", { type: "Buy", assettype: "Crypto", identifier: "BTC-EUR", shares: "1", price: "1", amount: "1" }, "identifier"],
    ["a bad fee", { type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1", fee: "x" }, "fee"],
    ["an impossible day", { datetime: "2024-02-30T00:00:00Z", type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1" }, "datetime"],
    ["hour 24", { datetime: "2024-03-01T24:00:00Z", type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1" }, "datetime"],
  ])("flags %s as unparseable", (_label, row, detail) => {
    const result = ok(readParqetCsv(csv(row)));
    expect(result.proposals).toEqual([]);
    expect(result.flagged).toEqual([{ records: [2], reason: "unparseable", detail }]);
  });

  it("aligns a Sell to its cash row", () => {
    const { proposals } = ok(
      readParqetCsv(
        csv({ type: "Sell", identifier: AAPL, shares: "5", price: "100", amount: "500,004", fee: "1", tax: "-2" }, cash("TransferIn", "501")),
      ),
    );
    expect(proposals).toEqual([expect.objectContaining({ type: "SELL", amount: "500", originalAmount: "500.004", records: [2, 3] })]);
    expect(cashEffect(proposals[0])).toBe("501");
  });

  it("aligns a Dividend within €0.01 to its cash row", () => {
    const { proposals } = ok(
      readParqetCsv(csv({ type: "Dividend", identifier: AAPL, amount: "30,005", tax: "4,5" }, cash("TransferIn", "25,5"))),
    );
    expect(proposals).toEqual([expect.objectContaining({ type: "DIVIDEND", amount: "30", originalAmount: "30.005" })]);
    expect(cashEffect(proposals[0])).toBe("25.5");
  });

  it("aligns a tax refund (cost with negative tax) to its TransferIn", () => {
    const { proposals } = ok(readParqetCsv(csv({ type: "cost", assettype: "Cash", amount: "0", tax: "-3,104" }, cash("TransferIn", "3,1"))));
    expect(proposals).toEqual([expect.objectContaining({ type: "TAX", tax: "-3.1", originalTax: "-3.104", records: [2, 3] })]);
    expect(cashEffect(proposals[0])).toBe("3.1");
  });

  it.each([
    ["", null],
    ["-12,5", "-12.5"],
  ])("keeps Parqet's realizedgains %j on a Sell as %j", (realizedgains, realizedGain) => {
    const { proposals } = ok(readParqetCsv(csv({ type: "Sell", identifier: AAPL, shares: "1", price: "1", amount: "1", realizedgains })));
    expect(proposals[0].realizedGain).toBe(realizedGain);
  });

  it("flags the cash leg of a flagged trade with it instead of booking a withdrawal", () => {
    const result = ok(
      readParqetCsv(csv({ type: "Buy", identifier: AAPL, shares: "1", price: "10", amount: "10", currency: "USD" }, cash("TransferOut", "9,2"))),
    );
    expect(result.proposals).toEqual([]);
    expect(result.flagged).toEqual([{ records: [2, 3], reason: "non-eur", detail: "USD" }]);
  });

  it("pairs cash rows and Security transfers by instant, however the datetime is spelled", () => {
    const result = ok(
      readParqetCsv(
        csv(
          { datetime: "2024-05-06T09:00:00Z", type: "Buy", identifier: AAPL, shares: "1", price: "10", amount: "10" },
          cash("TransferOut", "10", "2024-05-06T11:00:00.000+02:00"),
          { datetime: "2024-05-07T00:00:00Z", type: "TransferOut", identifier: AAPL, shares: "1" },
          { datetime: "2024-05-07T00:00:00.000+00:00", type: "TransferIn", identifier: "DE000SYN0013", shares: "1" },
        ),
      ),
    );
    expect(result.flagged).toEqual([]);
    expect(result.proposals).toEqual([expect.objectContaining({ type: "BUY", records: [2, 3] })]);
    expect(result.isinChanges).toEqual([expect.objectContaining({ oldKey: AAPL, newKey: "DE000SYN0013", records: [4, 5] })]);
  });

  it("takes an ISIN change after the last Transaction into the export date", () => {
    const result = ok(
      readParqetCsv(
        csv(
          { datetime: "2024-05-06T09:00:00Z", type: "Buy", identifier: AAPL, shares: "1", price: "10", amount: "10" },
          { datetime: "2024-06-01T00:00:00Z", type: "TransferOut", identifier: AAPL, shares: "1" },
          { datetime: "2024-06-01T00:00:00Z", type: "TransferIn", identifier: "DE000SYN0013", shares: "2" },
        ),
      ),
    );
    expect(result.exportDate).toBe("2024-06-01");
  });

  it("flags a row with the wrong field count as unparseable", () => {
    const result = ok(readParqetCsv(`${HEADER}\n${T};1;1`));
    expect(result.flagged).toEqual([{ records: [2], reason: "unparseable" }]);
    expect(result.exportDate).toBeNull();
  });

  it.each([
    ["Buy", "Cash", "Buy/Cash"],
    ["Split", "Security", "Split/Security"],
    ["Buy", "Bond", "Buy/Bond"],
  ])("flags type %s with assettype %s as unsupported-row", (type, assettype, detail) => {
    const result = ok(readParqetCsv(csv({ type, assettype, identifier: AAPL, shares: "1", price: "1", amount: "1" })));
    expect(result.flagged).toEqual([{ records: [2], reason: "unsupported-row", detail }]);
  });

  it.each([
    ["2024-03-01T00:00:00.000Z", "2024-03-01"],
    ["2024-03-01T06:00:00.000Z", "2024-03-01"],
    ["2024-03-31T22:30:00Z", "2024-04-01"],
  ])("maps %s to business date %s (Europe/Berlin)", (datetime, date) => {
    const { proposals } = ok(readParqetCsv(csv(cash("TransferIn", "1", datetime))));
    expect(proposals[0].date).toBe(date);
  });

  it("reads Crypto with 8-decimal quantities as an upper-case symbol", () => {
    const result = ok(
      readParqetCsv(csv({ type: "Buy", assettype: "Crypto", identifier: "btc", shares: "0,00012345", price: "40000", amount: "4,938" })),
    );
    expect(result.proposals[0]).toMatchObject({ type: "BUY", securityKey: "BTC", quantity: "0.00012345" });
    expect(result.securities).toEqual([{ key: "BTC", isin: null, cryptoSymbol: "BTC", name: "BTC", proposedAssetType: "CRYPTO" }]);
  });

  it("orders same-instant rows by reverse file position and cuts names to 100 characters", () => {
    const longName = "x".repeat(120);
    const result = ok(
      readParqetCsv(
        csv(
          { type: "Sell", identifier: AAPL, shares: "1", price: "1", amount: "1", holdingname: `  ${longName}  ` },
          { type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1", holdingname: "Alt" },
        ),
      ),
    );
    expect(result.proposals.map((p) => p.type)).toEqual(["BUY", "SELL"]);
    expect(result.securities[0].name).toBe("x".repeat(100));
  });

  it("uses the export date of all parsed rows when nothing is proposed", () => {
    const result = ok(readParqetCsv(csv({ type: "Buy", identifier: AAPL, shares: "1", price: "1", amount: "1", currency: "USD" })));
    expect(result.proposals).toEqual([]);
    expect(result.exportDate).toBe("2024-05-06");
  });
});

describe("readParqetCsv — file problems", () => {
  it("reports missing columns", () => {
    expect(readParqetCsv(HEADER.replace(";amount", ""))).toEqual({ ok: false, reason: "missing-columns", columns: ["amount"] });
  });

  it.each(["", "﻿", `${HEADER}\r\n`])("reports an empty file for %j", (text) => {
    expect(readParqetCsv(text)).toEqual({ ok: false, reason: "empty-file" });
  });
});
