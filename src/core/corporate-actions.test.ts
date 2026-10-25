import { describe, expect, it } from "vitest";
import {
  adjustTrades,
  ALL_SPLITS,
  parseSplitRatio,
  type Split,
  splitAdjustedPrice,
  splitAdjustment,
  splitDivisor,
  splitScale,
  scaleTrades,
} from "./corporate-actions";

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

describe("adjustTrades", () => {
  const buy = (date: string, quantity: string, price: string | null = null, securityId = "s1") => ({
    securityId,
    type: "BUY",
    date,
    quantity,
    price,
    amount: "1000",
  });

  it("adjusts quantity and price of rows dated before the split, not on or after it", () => {
    const rows = [buy("2024-01-02", "10", "100"), buy("2024-03-01", "5", "30"), buy("2024-04-01", "5", "30")];
    const adjusted = adjustTrades(rows, [split("2024-03-01", "1", "4")], "2024-06-01");
    expect(adjusted.map((row) => [row.quantity, row.price, row.amount])).toEqual([
      ["40", "25", "1000"],
      ["5", "30", "1000"],
      ["5", "30", "1000"],
    ]);
    expect(adjusted[1]).toBe(rows[1]);
    expect(rows[0].quantity).toBe("10");
  });

  it("ignores splits after asOf, of other Securities and non-trade rows", () => {
    const rows = [buy("2024-01-02", "10"), buy("2024-01-02", "10", null, "s2"), { ...buy("2024-01-02", "10"), type: "DIVIDEND" }];
    const adjusted = adjustTrades(rows, [split("2024-03-01", "1", "4")], "2024-02-28");
    expect(adjusted.map((row) => row.quantity)).toEqual(["10", "10", "10"]);
    expect(adjustTrades(rows, [split("2024-03-01", "1", "4")], ALL_SPLITS).map((row) => row.quantity)).toEqual(["40", "10", "10"]);
  });

  it("multiplies several splits (1:2 then 1:3 → factor 6) and handles reverse splits", () => {
    const splits = [split("2024-02-01", "1", "2"), split("2024-03-01", "1", "3")];
    expect(splitAdjustment("s1", "2024-01-01", "10", splits, ALL_SPLITS)).toBe("60");
    expect(splitAdjustment("s1", "2024-02-15", "10", splits, ALL_SPLITS)).toBe("30");
    expect(splitAdjustment("s1", "2024-03-01", "10", splits, ALL_SPLITS)).toBeNull();
    expect(splitAdjustment("s1", "2024-01-01", "15", [split("2024-02-01", "10", "1")], ALL_SPLITS)).toBe("1.5");
    expect(splitAdjustedPrice("s1", "2024-01-01", "600", splits, ALL_SPLITS)).toBe("100");
  });

  it("scales quantities exactly by multiplication; scaled ÷ divisor is the adjusted quantity", () => {
    const splits = [split("2024-03-01", "3", "1"), split("2024-05-01", "1", "2")];
    expect(splitScale("s1", "2024-01-01", splits, ALL_SPLITS).toFixed()).toBe("2");
    expect(splitScale("s1", "2024-04-01", splits, ALL_SPLITS).toFixed()).toBe("6");
    expect(splitScale("s1", "2024-01-01", splits, "2024-04-01").toFixed()).toBe("1");
    expect(splitDivisor("s1", splits, ALL_SPLITS).toFixed()).toBe("3");
    const rows = [
      { securityId: "s1", type: "BUY", date: "2024-01-01", quantity: "10" },
      { securityId: "s1", type: "SELL", date: "2024-06-01", quantity: "4" },
    ];
    expect(scaleTrades(rows, splits, ALL_SPLITS).map((row) => row.quantity)).toEqual(["20", "12"]);
  });
});
