import { describe, expect, it } from "vitest";
import type { PriceMarkField, PriceMarkProblem, PriceMarksViewItem } from "@/modules/marks";
import { priceMarkFieldPath, priceMarkMessage, priceMarksPatchOf, priceMarksPayload, priceMarksRefusal } from "./price-marks";

const NO_PRICE_STATE = { price: null, priceDate: null, stop: null, target: null, breached: "none" } as const;

describe("priceMarksPayload", () => {
  it("maps a FIXED stop (breached) and a target", () => {
    const item: PriceMarksViewItem = {
      marks: {
        securityId: "s",
        stop: { type: "FIXED", value: "150", source: "Börse Online", setDate: "2026-10-01" },
        target: { price: "200", source: null, setDate: "2026-10-02" },
      },
      state: {
        price: "140",
        priceDate: "2026-10-27",
        stop: { effective: "75", high: null, distance: "-0.4642857142857142857" },
        target: { price: "100", distance: "-0.2857142857142857143" },
        breached: "stop",
      },
    };
    expect(priceMarksPayload(item)).toEqual({
      basis: "latest close",
      price: "140",
      price_date: "2026-10-27",
      stop: {
        type: "FIXED",
        price: "150",
        percent: null,
        effective: "75",
        high: null,
        distance: "-0.4642857142857142857",
        source: "Börse Online",
        set_date: "2026-10-01",
      },
      target: { price: "200", effective: "100", distance: "-0.2857142857142857143", source: null, set_date: "2026-10-02" },
      breached: "stop",
    });
  });

  it("maps a TRAILING stop with percent and high, and a reached target", () => {
    const item: PriceMarksViewItem = {
      marks: { securityId: "s", stop: { type: "TRAILING", value: "10", source: null, setDate: "2026-10-28" }, target: { price: "130", source: "Zeitung", setDate: "2026-10-28" } },
      state: { price: "140", priceDate: "2026-10-27", stop: { effective: "126", high: "140", distance: "-0.1" }, target: { price: "130", distance: "-0.0714" }, breached: "target" },
    };
    const payload = priceMarksPayload(item);
    expect(payload.stop).toEqual({ type: "TRAILING", price: null, percent: "10", effective: "126", high: "140", distance: "-0.1", source: null, set_date: "2026-10-28" });
    expect(payload.target).toEqual({ price: "130", effective: "130", distance: "-0.0714", source: "Zeitung", set_date: "2026-10-28" });
    expect(payload.breached).toBe("target");
  });

  it("gives null marks and breached none without marks, with or without a price", () => {
    expect(priceMarksPayload({ marks: null, state: NO_PRICE_STATE })).toEqual({
      basis: "latest close",
      price: null,
      price_date: null,
      stop: null,
      target: null,
      breached: "none",
    });
    const priced = priceMarksPayload({ marks: null, state: { ...NO_PRICE_STATE, price: "140", priceDate: "2026-10-27" } });
    expect(priced).toMatchObject({ price: "140", price_date: "2026-10-27", stop: null, target: null, breached: "none" });
  });

  it("keeps a trailing stop without any price (effective null)", () => {
    const payload = priceMarksPayload({
      marks: { securityId: "s", stop: { type: "TRAILING", value: "15", source: null, setDate: "2026-10-28" }, target: null },
      state: { ...NO_PRICE_STATE, stop: { effective: null, high: null, distance: null } },
    });
    expect(payload.stop).toMatchObject({ type: "TRAILING", percent: "15", price: null, effective: null, high: null, distance: null });
    expect(payload.target).toBeNull();
  });
});

describe("priceMarksPatchOf", () => {
  it("leaves omitted marks out, keeps null and maps objects", () => {
    expect(priceMarksPatchOf({})).toEqual({});
    expect(priceMarksPatchOf({ stop: null, target: null })).toEqual({ stop: null, target: null });
    expect(priceMarksPatchOf({ target: { price: "300", source: "Zeitung" } })).toEqual({
      target: { price: "300", source: "Zeitung", setDate: undefined },
    });
    expect("stop" in priceMarksPatchOf({ target: null })).toBe(false);
  });

  it("uses percent for TRAILING and price otherwise", () => {
    expect(priceMarksPatchOf({ stop: { type: "TRAILING", price: "99", percent: "10", set_date: "2026-10-01" } })).toEqual({
      stop: { type: "TRAILING", value: "10", source: undefined, setDate: "2026-10-01" },
    });
    expect(priceMarksPatchOf({ stop: { type: "FIXED", price: "92.40", percent: "10", source: "x" } }).stop).toEqual({
      type: "FIXED",
      value: "92.40",
      source: "x",
      setDate: undefined,
    });
    expect(priceMarksPatchOf({ stop: { type: "fixed", price: "1" } }).stop).toMatchObject({ type: "fixed", value: "1" });
    expect(priceMarksPatchOf({ stop: { type: "TRAILING", price: "1" } }).stop).toMatchObject({ type: "TRAILING", value: undefined });
  });
});

describe("refusals", () => {
  it.each<[PriceMarkField, unknown, string]>([
    ["stopType", "fixed", "stop.type"],
    ["stopValue", "TRAILING", "stop.percent"],
    ["stopValue", "FIXED", "stop.price"],
    ["stopValue", undefined, "stop.price"],
    ["stopSource", "FIXED", "stop.source"],
    ["stopSetDate", "FIXED", "stop.set_date"],
    ["targetPrice", undefined, "target.price"],
    ["targetSource", undefined, "target.source"],
    ["targetSetDate", undefined, "target.set_date"],
  ])("maps %s (stop type %s) to %s", (field, stopType, path) => {
    expect(priceMarkFieldPath(field, stopType)).toBe(path);
  });

  it.each<[string, PriceMarkProblem, string]>([
    ["stop.price", "required", "Der Stoppkurs fehlt."],
    ["stop.type", "invalid", "Die Art des Stopps muss FIXED oder TRAILING sein."],
    ["stop.price", "invalid", "Der Stoppkurs muss eine Dezimalzahl mit Punkt sein, z. B. 92.40."],
    ["target.set_date", "invalid", "Das Datum des Kursziels muss im Format JJJJ-MM-TT angegeben werden."],
    ["target.price", "not-positive", "Das Kursziel muss größer als 0 sein."],
    ["stop.percent", "out-of-range", "Der Prozentsatz des nachlaufenden Stopps muss zwischen 1 und 50 liegen."],
    ["stop.source", "too-long", "Die Quelle des Stopps darf höchstens 200 Zeichen lang sein."],
    ["stop.set_date", "future-date", "Das Datum des Stopps darf nicht in der Zukunft liegen."],
  ])("message for %s / %s", (path, problem, message) => {
    expect(priceMarkMessage(path, problem)).toBe(message);
  });

  it("builds the refusal payload", () => {
    const refusal = priceMarksRefusal({ ok: false, reason: "price-marks-invalid", field: "stopValue", problem: "out-of-range" }, "TRAILING");
    expect(refusal.isError).toBe(true);
    expect(JSON.parse((refusal.content[0] as { text: string }).text)).toEqual({
      error: "price-marks-invalid",
      field: "stop.percent",
      problem: "out-of-range",
      message: "Der Prozentsatz des nachlaufenden Stopps muss zwischen 1 und 50 liegen.",
    });
  });
});
