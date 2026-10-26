import { describe, expect, it } from "vitest";
import {
  adjustedPrice,
  adjustedQuantity,
  ALL_ACTIONS,
  type CorporateActions,
  type IsinChange,
  LotBook,
  parseSplitRatio,
  replayEvents,
  type Split,
  splitAdjustment,
  unadjustSplitPrice,
} from "./corporate-actions";
import { ExactDecimal } from "./decimal";

const split = (date: string, ratioOld: string, ratioNew: string, securityId = "s1"): Split => ({
  securityId,
  date,
  ratioOld,
  ratioNew,
});

describe("parseSplitRatio", () => {
  it.each([
    ["1:4", { ratioOld: "1", ratioNew: "4" }],
    [" 1 : 4 ", { ratioOld: "1", ratioNew: "4" }],
    ["10:1", { ratioOld: "10", ratioNew: "1" }],
    ["999999:1", { ratioOld: "999999", ratioNew: "1" }],
  ])("parses %j", (text, expected) => {
    expect(parseSplitRatio(text)).toEqual(expected);
  });

  it.each(["0:4", "4:4", "1,5:3", "abc", "", "01:4", "1:4:2", "1000000:1", "-1:4", "1:", 14, null])(
    "rejects %j",
    (text) => {
      expect(parseSplitRatio(text)).toBeNull();
    },
  );
});

describe("splitAdjustment", () => {
  it("multiplies several splits (1:2 then 1:3 → factor 6) and handles reverse splits", () => {
    const splits = [split("2024-02-01", "1", "2"), split("2024-03-01", "1", "3")];
    expect(splitAdjustment("s1", "2024-01-01", "10", splits, ALL_ACTIONS)).toBe("60");
    expect(splitAdjustment("s1", "2024-02-15", "10", splits, ALL_ACTIONS)).toBe("30");
    expect(splitAdjustment("s1", "2024-03-01", "10", splits, ALL_ACTIONS)).toBeNull();
    expect(splitAdjustment("s1", "2024-01-01", "10", splits, "2024-02-15")).toBe("20");
    expect(splitAdjustment("s1", "2024-01-01", "15", [split("2024-02-01", "10", "1")], ALL_ACTIONS)).toBe("1.5");
    expect(splitAdjustment("s2", "2024-01-01", "10", splits, ALL_ACTIONS)).toBeNull();
  });
});

const change = (date: string, oldQuantity: string, newQuantity: string, oldSecurityId = "A", newSecurityId = "B"): IsinChange => ({
  oldSecurityId,
  newSecurityId,
  date,
  oldQuantity,
  newQuantity,
});

describe("replayEvents", () => {
  it("orders by date, then splits, ISIN changes (given order), Transactions (sequence); drops rows after asOf", () => {
    const rows = [
      { securityId: "A", type: "BUY", date: "2024-03-01", sequence: 2, quantity: "1" },
      { securityId: "A", type: "BUY", date: "2024-03-01", sequence: 1, quantity: "1" },
      { securityId: "A", type: "DIVIDEND", date: "2024-01-01", sequence: 1, quantity: null },
      { securityId: "A", type: "BUY", date: "2024-09-01", sequence: 1, quantity: "1" },
    ];
    const first = change("2024-03-01", "1", "1", "A", "B");
    const second = change("2024-03-01", "1", "1", "B", "C");
    const events = replayEvents(rows, { splits: [split("2024-03-01", "1", "2", "A")], isinChanges: [first, second] }, "2024-06-01");
    expect(events.map((event) => (event.kind === "trade" ? `trade${event.row.sequence}` : event.kind))).toEqual([
      "split",
      "isin-change",
      "isin-change",
      "trade1",
      "trade2",
    ]);
    expect(events[1]).toEqual({ kind: "isin-change", change: first });
  });
});

describe("LotBook", () => {
  it("moves lots into a Security that already holds lots, merged by (date, sequence), exactly", () => {
    const book = new LotBook();
    book.buy("B", "2023-06-01", 1, "4", new ExactDecimal(40));
    book.buy("A", "2022-01-03", 1, "10", new ExactDecimal(100));
    book.split({ securityId: "B", date: "2023-07-01", ratioOld: "3", ratioNew: "1" });
    book.isinChange(change("2024-03-01", "3", "1"));
    const divisor = book.divisor("B");
    expect(book.lots("B").map((lot) => [lot.date, lot.quantity.dividedBy(divisor).toFixed(5), lot.costBasis.toFixed()])).toEqual([
      ["2022-01-03", "3.33333", "100"],
      ["2023-06-01", "1.33333", "40"],
    ]);
    expect(book.lots("A")).toEqual([]);
    expect(book.net("A").scaled.isZero()).toBe(true);
    // 10/3 + 4/3 = 14/3 is held exactly (scaled ÷ divisor, no rounding)
    const net = book.net("B");
    expect(net.scaled.times(3).equals(net.divisor.times(14))).toBe(true);
  });
});

describe("adjustedPrice", () => {
  const actions: CorporateActions = {
    splits: [split("2024-02-01", "1", "2", "A"), split("2024-05-01", "1", "4", "B")],
    isinChanges: [change("2024-03-01", "10", "5")],
  };

  it("follows splits and ISIN changes after the observation up to asOf", () => {
    expect(adjustedPrice("A", "2024-01-01", "100", actions, ALL_ACTIONS)).toEqual({ securityId: "B", price: "25" });
    expect(adjustedPrice("A", "2024-01-01", "100", actions, "2024-04-01")).toEqual({ securityId: "B", price: "100" });
    expect(adjustedPrice("A", "2024-01-01", "100", actions, "2024-02-15")).toEqual({ securityId: "A", price: "50" });
    expect(adjustedPrice("A", "2024-03-01", "100", actions, "2024-04-01")).toEqual({ securityId: "A", price: "100" });
    expect(adjustedPrice("C", "2024-01-01", "7", actions, ALL_ACTIONS)).toEqual({ securityId: "C", price: "7" });
  });

  it("follows a chain A → B (10 → 5) → C (2 → 1): price × o1/n1 × o2/n2", () => {
    const chain: CorporateActions = {
      splits: [],
      isinChanges: [change("2024-03-01", "10", "5"), change("2024-05-01", "2", "1", "B", "C")],
    };
    expect(adjustedPrice("A", "2024-01-01", "100", chain, ALL_ACTIONS)).toEqual({ securityId: "C", price: "400" });
  });
});

describe("adjustedQuantity", () => {
  const actions: CorporateActions = {
    splits: [split("2024-02-01", "1", "2", "A"), split("2024-05-01", "1", "4", "B")],
    isinChanges: [change("2024-03-01", "10", "5")],
  };

  it("applies the inverse factors of adjustedPrice, so price × quantity is unchanged", () => {
    expect(adjustedQuantity("A", "2024-01-01", "10", actions, ALL_ACTIONS)).toEqual({ securityId: "B", quantity: "40" });
    expect(adjustedQuantity("A", "2024-01-01", "10", actions, "2024-04-01")).toEqual({ securityId: "B", quantity: "10" });
    expect(adjustedQuantity("A", "2024-01-01", "10", actions, "2024-02-15")).toEqual({ securityId: "A", quantity: "20" });
    expect(adjustedQuantity("A", "2024-03-01", "10", actions, "2024-04-01")).toEqual({ securityId: "A", quantity: "10" });
    expect(adjustedQuantity("C", "2024-01-01", "7", actions, ALL_ACTIONS)).toEqual({ securityId: "C", quantity: "7" });
    for (const asOf of [ALL_ACTIONS, "2024-04-01", "2024-02-15"]) {
      const price = adjustedPrice("A", "2024-01-01", "100", actions, asOf).price;
      const quantity = adjustedQuantity("A", "2024-01-01", "10", actions, asOf).quantity;
      expect(new ExactDecimal(price).times(quantity).toFixed()).toBe("1000");
    }
  });
});

describe("unadjustSplitPrice", () => {
  const split = (date: string, ratioOld: string, ratioNew: string, securityId = "s1"): Split => ({ securityId, date, ratioOld, ratioNew });

  it("multiplies a close before a 1:10 split by 10; the split date itself is as traded", () => {
    const splits = [split("2024-06-10", "1", "10")];
    expect(unadjustSplitPrice("s1", "2024-06-07", "110.44000244140625", splits)).toBe("1104.4");
    expect(unadjustSplitPrice("s1", "2024-06-10", "114.22000122070312", splits)).toBe("114.22");
  });

  it("combines every later split, ignores other Securities, and handles reverse splits", () => {
    const splits = [split("2024-01-10", "1", "4"), split("2024-06-10", "1", "2"), split("2024-03-01", "1", "100", "other")];
    expect(unadjustSplitPrice("s1", "2024-01-09", "10", splits)).toBe("80");
    expect(unadjustSplitPrice("s1", "2024-02-01", "10", splits)).toBe("20");
    expect(unadjustSplitPrice("s1", "2024-07-01", "10", splits)).toBe("10");
    expect(unadjustSplitPrice("s1", "2024-01-09", "30", [split("2024-01-10", "10", "1")])).toBe("3");
    expect(unadjustSplitPrice("s1", "2024-01-09", "10", [split("2024-01-10", "3", "1")])).toBe("3.3333");
  });

  it("rounds half-up to 4 decimals also without a split", () => {
    expect(unadjustSplitPrice("s1", "2024-01-09", "197.27999877929688", [])).toBe("197.28");
    expect(unadjustSplitPrice("s1", "2024-01-09", "1.00005", [])).toBe("1.0001");
    expect(unadjustSplitPrice("s1", "2024-01-09", "1.00004999", [])).toBe("1");
  });
});
