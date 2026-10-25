import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS as NONE, type Split } from "./corporate-actions";
import { firstOversell, sellableAt, sellableQuantity, type TradeRow } from "./holdings";

let sequence = 0;
const row = (type: string, date: string, quantity: string, securityId = "s1"): TradeRow => ({
  securityId,
  type,
  date,
  sequence: ++sequence,
  quantity,
});

describe("sellableQuantity", () => {
  it("is zero without trades", () => {
    expect(sellableQuantity([], "s1", "2026-10-25", NONE)).toBe("0");
  });

  it("is the held quantity for a sell dated after every trade", () => {
    const trades = [row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-05", "2.5"), row("BUY", "2026-10-06", "0.00012345")];
    expect(sellableQuantity(trades, "s1", "2026-10-25", NONE)).toBe("7.50012345");
  });

  it("includes trades on the same date (appended at the end of the date)", () => {
    expect(sellableQuantity([row("BUY", "2026-10-25", "10")], "s1", "2026-10-25", NONE)).toBe("10");
  });

  it("ignores later buys and other Securities", () => {
    const trades = [row("BUY", "2026-10-01", "10", "other"), row("BUY", "2026-10-20", "5")];
    expect(sellableQuantity(trades, "s1", "2026-10-10", NONE)).toBe("0");
  });

  it("takes the minimum running quantity from the insertion point onward", () => {
    const trades = [row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-20", "10")];
    expect(sellableQuantity(trades, "s1", "2026-10-10", NONE)).toBe("0");
    const partial = [row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-20", "4"), row("BUY", "2026-10-21", "4")];
    expect(sellableQuantity(partial, "s1", "2026-10-10", NONE)).toBe("6");
  });

  it("orders by date then sequence regardless of input order", () => {
    const trades: TradeRow[] = [
      { securityId: "s1", type: "SELL", date: "2026-10-02", sequence: 2, quantity: "3" },
      { securityId: "s1", type: "BUY", date: "2026-10-02", sequence: 1, quantity: "5" },
      { securityId: "s1", type: "DIVIDEND", date: "2026-10-03", sequence: 1, quantity: null },
    ];
    expect(sellableQuantity(trades, "s1", "2026-10-02", NONE)).toBe("2");
  });
});

describe("sellableAt", () => {
  const at = (date: string, sequence: number) => ({ date, sequence });
  const trades: TradeRow[] = [
    { securityId: "s1", type: "BUY", date: "2026-10-01", sequence: 1, quantity: "10" },
    { securityId: "s1", type: "SELL", date: "2026-10-01", sequence: 3, quantity: "2" },
    { securityId: "s1", type: "SELL", date: "2026-10-20", sequence: 1, quantity: "5" },
    { securityId: "s2", type: "BUY", date: "2026-09-01", sequence: 1, quantity: "100" },
  ];

  it("counts rows before the position as held and later rows as constraints", () => {
    expect(sellableAt(trades, "s1", at("2026-10-01", 2), NONE)).toBe("3");
    expect(sellableAt(trades, "s1", at("2026-10-25", 1), NONE)).toBe("3");
  });

  it("treats a row at the position itself as later", () => {
    expect(sellableAt(trades, "s1", at("2026-10-01", 1), NONE)).toBe("0");
  });

  it("is zero for an unknown Security and never negative", () => {
    expect(sellableAt(trades, "s3", at("2026-10-25", 1), NONE)).toBe("0");
    expect(sellableAt([{ securityId: "s1", type: "SELL", date: "2026-10-01", sequence: 1, quantity: "1" }], "s1", at("2026-10-02", 1), NONE)).toBe("0");
  });
});

describe("firstOversell", () => {
  it("is null while the held quantity never goes negative", () => {
    expect(firstOversell([], NONE)).toBeNull();
    expect(firstOversell([row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-02", "10")], NONE)).toBeNull();
  });

  it("finds the first SELL in ledger order that oversells", () => {
    const early: TradeRow = { securityId: "s1", type: "SELL", date: "2026-10-05", sequence: 1, quantity: "6" };
    const later: TradeRow = { securityId: "s1", type: "SELL", date: "2026-10-20", sequence: 1, quantity: "6" };
    const buy: TradeRow = { securityId: "s1", type: "BUY", date: "2026-10-01", sequence: 1, quantity: "10" };
    expect(firstOversell([later, early, buy], NONE)).toBe(later);
    expect(firstOversell([later, buy], NONE)).toBeNull();
    expect(firstOversell([early], NONE)).toBe(early);
  });
});

describe("holdings with splits", () => {
  const split = { securityId: "s1", date: "2024-03-01", ratioOld: "1", ratioNew: "4" };
  const at = (date: string, sequence: number) => ({ date, sequence });

  it("counts pre-split units in the post-split basis for a later SELL", () => {
    const trades = [row("BUY", "2024-01-02", "10")];
    expect(sellableQuantity(trades, "s1", "2024-05-01", splitsOnly(split))).toBe("40");
    expect(sellableAt(trades, "s1", at("2024-05-01", 1), splitsOnly(split))).toBe("40");
  });

  it("states the sellable quantity in the units of the SELL's own date", () => {
    const trades = [row("BUY", "2024-01-02", "10"), row("SELL", "2024-05-01", "20")];
    expect(sellableAt(trades, "s1", at("2024-02-01", 1), splitsOnly(split))).toBe("5");
  });

  it("finds oversells in the adjusted basis and returns the original row", () => {
    const sell = row("SELL", "2024-05-01", "40");
    const trades = [row("BUY", "2024-01-02", "10"), sell];
    expect(firstOversell(trades, splitsOnly(split))).toBeNull();
    expect(firstOversell(trades, NONE)).toBe(sell);
    const over = row("SELL", "2024-05-02", "1");
    expect(firstOversell([...trades, over], splitsOnly(split))).toBe(over);
  });
});

describe("holdings with a non-terminating reverse split", () => {
  it("sells exactly what pre-split buys became after 3:1 (10/3 + 2/3 = 4)", () => {
    const split = { securityId: "s1", date: "2024-03-01", ratioOld: "3", ratioNew: "1" };
    const trades = [row("BUY", "2024-01-02", "10"), row("BUY", "2024-01-03", "2"), row("SELL", "2024-05-01", "4")];
    expect(firstOversell(trades, splitsOnly(split))).toBeNull();
    expect(sellableQuantity(trades.slice(0, 2), "s1", "2024-05-01", splitsOnly(split))).toBe("4");
    expect(sellableQuantity(trades.slice(0, 2), "s1", "2024-02-01", splitsOnly(split))).toBe("12");
  });
});

function splitsOnly(...splits: Split[]): CorporateActions {
  return { splits, isinChanges: [] };
}

describe("holdings with ISIN changes", () => {
  const change = (oldQuantity = "1", newQuantity = "1"): CorporateActions => ({
    splits: [],
    isinChanges: [{ oldSecurityId: "A", newSecurityId: "B", date: "2024-03-01", oldQuantity, newQuantity }],
  });
  const t = (type: string, date: string, quantity: string, securityId: string, seq = 1): TradeRow => ({ securityId, type, date, sequence: seq, quantity });
  const at = (date: string, sequence: number) => ({ date, sequence });

  it("lets the new Security sell the moved quantity and leaves nothing of the old one", () => {
    const trades = [t("BUY", "2024-01-02", "10", "A")];
    expect(sellableQuantity(trades, "B", "2024-04-01", change("10", "5"))).toBe("5");
    expect(sellableQuantity(trades, "A", "2024-04-01", change())).toBe("0");
    expect(sellableQuantity(trades, "B", "2024-02-01", change())).toBe("0");
  });

  it("limits a SELL of the old Security before the change by later SELLs of the new one (in old units)", () => {
    const trades = [t("BUY", "2024-01-02", "10", "A"), t("SELL", "2024-04-01", "4", "B")];
    expect(sellableAt(trades, "A", at("2024-02-01", 1), change("10", "5"))).toBe("2");
    expect(sellableAt(trades, "A", at("2024-02-01", 1), change())).toBe("6");
  });

  it("finds a SELL of the old Security after the change and a SELL of the new one without moved lots", () => {
    const sellA = t("SELL", "2024-04-01", "5", "A");
    const trades = [t("BUY", "2024-01-02", "10", "A"), sellA];
    expect(firstOversell(trades, NONE)).toBeNull();
    expect(firstOversell(trades, change())).toBe(sellA);
    const sellB = t("SELL", "2024-04-01", "10", "B");
    const withB = [t("BUY", "2024-01-02", "10", "A"), sellB];
    expect(firstOversell(withB, change())).toBeNull();
    expect(firstOversell(withB, NONE)).toBe(sellB);
  });
});
