import { describe, expect, it } from "vitest";
import reference from "../../../test/fixtures/technical/reference-series.json";
import { TECHNICAL_PARAMETERS, technicalPosition } from "@/core/technical";
import { assetTypeFromFigi, matchSecurities, TECHNICAL_DESCRIPTION, technicalPayload } from "./tools";

describe("assetTypeFromFigi", () => {
  it.each([
    ["ETP", "Mutual Fund", "ETF"],
    ["Mutual Fund", "ETP", "ETF"],
    ["Common Stock", "Common Stock", "STOCK"],
    ["ADR", null, "STOCK"],
    ["GDR", null, "STOCK"],
    ["REIT", "Common Stock", "STOCK"],
    ["Preference", null, "STOCK"],
    ["Open-End Fund", "Mutual Fund", "FUND"],
    ["closed-end fund", null, "FUND"],
    ["Fund of Funds", null, "FUND"],
    [null, "Mutual Fund", "FUND"],
    ["Warrant", null, "CERTIFICATE"],
    ["Index Warrant", null, "CERTIFICATE"],
    ["Structured Product", null, "CERTIFICATE"],
    ["Certificate", null, "CERTIFICATE"],
    ["Unknown thing", "Common Stock", "STOCK"],
    ["Common Stock", "Warrant", "STOCK"],
    ["Corp Bond", null, null],
    [null, null, null],
  ] as const)("maps %j / %j to %j", (securityType, securityType2, expected) => {
    expect(assetTypeFromFigi({ securityType, securityType2 })).toBe(expected);
  });
});

describe("matchSecurities", () => {
  const securities = Array.from({ length: 25 }, (_, i) => ({ name: `Fonds ${String(i).padStart(2, "0")}`, isin: null, cryptoSymbol: null }));

  it("matches name, ISIN and crypto symbol case-insensitively as substrings", () => {
    const list = [
      { name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null },
      { name: "Bitcoin", isin: null, cryptoSymbol: "BTC" },
      { name: "Äpfel AG", isin: "US0378331005", cryptoSymbol: null },
    ];
    expect(matchSecurities(list, "sap").map((s) => s.name)).toEqual(["SAP SE"]);
    expect(matchSecurities(list, "de000716").map((s) => s.name)).toEqual(["SAP SE"]);
    expect(matchSecurities(list, " btc ").map((s) => s.name)).toEqual(["Bitcoin"]);
    expect(matchSecurities(list, "äPFEL").map((s) => s.name)).toEqual(["Äpfel AG"]);
    expect(matchSecurities(list, "xyz")).toEqual([]);
  });

  it("returns at most 20 in the given order", () => {
    const found = matchSecurities(securities, "fonds");
    expect(found).toHaveLength(20);
    expect(found[0].name).toBe("Fonds 00");
  });
});

const TECHNICAL_KEYS = ["as_of", "basis", "fifty_two_weeks", "macd", "rsi", "trend", "tsi"];
const INSUFFICIENT = { value: null, reason: "insufficient-history" };

describe("technicalPayload", () => {
  it("maps every signal of a full history, without the series", () => {
    const position = technicalPosition(reference.closes, reference.today);
    const { trend, rsi, macd, tsi, fiftyTwoWeeks } = position;
    if (trend.value === null || rsi.value === null || macd.value === null || tsi.value === null || fiftyTwoWeeks.value === null) {
      throw new Error("reference series must give every signal");
    }
    const payload = technicalPayload(position);
    expect(Object.keys(payload).sort()).toEqual(TECHNICAL_KEYS);
    expect(payload).toEqual({
      basis: "closing prices",
      as_of: "2026-09-25",
      trend: { value: trend.value, date: "2026-09-25", key: trend.key, label: trend.label, sma200: trend.sma200 },
      rsi: { value: rsi.value, date: "2026-09-25", key: rsi.key, label: rsi.label },
      macd: { value: macd.value, date: "2026-09-25", key: macd.key, label: macd.label, signal: macd.signal, histogram: macd.histogram },
      tsi: { value: tsi.value, date: "2026-09-25", key: tsi.key, label: tsi.label, signal: tsi.signal },
      fifty_two_weeks: {
        value: fiftyTwoWeeks.value,
        date: "2026-09-25",
        key: fiftyTwoWeeks.key,
        label: fiftyTwoWeeks.label,
        high: fiftyTwoWeeks.high.price,
        high_date: fiftyTwoWeeks.high.date,
        low: fiftyTwoWeeks.low.price,
        low_date: fiftyTwoWeeks.low.date,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("series");
  });

  it("gives insufficient-history for the indicators with one close, keeping the 52-week signal", () => {
    const payload = technicalPayload(technicalPosition([{ date: "2026-09-25", price: "100" }], "2026-09-28"));
    expect(payload).toEqual({
      basis: "closing prices",
      as_of: "2026-09-25",
      trend: INSUFFICIENT,
      rsi: INSUFFICIENT,
      macd: INSUFFICIENT,
      tsi: INSUFFICIENT,
      fifty_two_weeks: {
        value: "0",
        date: "2026-09-25",
        key: "near-high",
        label: "nahe Hoch",
        high: "100",
        high_date: "2026-09-25",
        low: "100",
        low_date: "2026-09-25",
      },
    });
  });

  it("gives as_of null and insufficient-history everywhere without closes", () => {
    expect(technicalPayload(technicalPosition([], "2026-09-28"))).toEqual({
      basis: "closing prices",
      as_of: null,
      trend: INSUFFICIENT,
      rsi: INSUFFICIENT,
      macd: INSUFFICIENT,
      tsi: INSUFFICIENT,
      fifty_two_weeks: INSUFFICIENT,
    });
  });
});

describe("TECHNICAL_DESCRIPTION", () => {
  const { trend, rsi, macd, tsi, fiftyTwoWeeks } = TECHNICAL_PARAMETERS;

  it("states the parameters, thresholds and minimums from TECHNICAL_PARAMETERS as whole phrases", () => {
    for (const phrase of [
      `at least ${trend.minCloses} closes`,
      `SMA${trend.smaWindow}`,
      `${trend.slopeLookback} closes earlier`,
      `RSI ${rsi.period} with Wilder smoothing, at least ${rsi.minCloses} closes`,
      `>= ${rsi.overbought}`,
      `<= ${rsi.oversold}`,
      `MACD ${macd.fast}/${macd.slow}, signal ${macd.signal}, at least ${macd.minCloses} closes`,
      `last ${macd.crossLookback} closes`,
      `TSI ${tsi.long}/${tsi.short}, signal ${tsi.signal}, scaled by ${tsi.scale}`,
      `at least ${tsi.minCloses} closes`,
      `today − ${fiftyTwoWeeks.windowDays} days`,
      `high × (1 − ${fiftyTwoWeeks.nearBand})`,
      `low × (1 + ${fiftyTwoWeeks.nearBand})`,
    ]) {
      expect(TECHNICAL_DESCRIPTION, phrase).toContain(phrase);
    }
  });

  it("describes the payload shape and edge semantics exactly", () => {
    for (const phrase of [
      "sma200",
      "extra fields signal (signal line) and histogram",
      "extra fields high, high_date, low, low_date",
      "siblings of value/date/key/label",
      'reason: "insufficient-history"',
      "fading when TSI >= 0 and at or below signal",
      "negative when TSI < 0 and at or below signal",
      "near-high taking precedence when both apply",
      "price_security",
      "successor after an ISIN change",
      "not a minimum number of closes",
      "often conflict",
      "no combined score",
      "not a recommendation",
    ]) {
      expect(TECHNICAL_DESCRIPTION, phrase).toContain(phrase);
    }
    expect(TECHNICAL_DESCRIPTION).not.toContain("details");
  });
});
