import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS } from "./corporate-actions";
import {
  carryPriceMarks,
  checkPriceMarksPatch,
  PRICE_MARK_SOURCE_MAX_LENGTH,
  type PriceMarks,
  priceMarkLines,
  priceMarkState,
  priceMarkWarnings,
  parsePriceMarksForm,
  type PriceMarksForm,
} from "./price-marks";
import type { PriceObservation, PriceSource } from "./prices";
import { ratioString, ReturnDecimal } from "./returns";

const TODAY = "2026-11-11";

let nextId = 0;
const obs = (date: string, price: string, securityId = "s1", source: PriceSource = "provider"): PriceObservation => ({
  id: `o${++nextId}`,
  securityId,
  date,
  sequence: 0,
  price,
  source,
  fetchedAt: source === "transaction" ? null : `${date}T18:00:00.000Z`,
  provider: source === "provider" ? "YAHOO" : null,
});

const fixedStop = (value: string, setDate = "2026-10-01") => ({ type: "FIXED" as const, value, source: null, setDate });
const trailingStop = (value: string, setDate = "2026-10-01") => ({ type: "TRAILING" as const, value, source: null, setDate });
const target = (price: string, setDate = "2026-10-01") => ({ price, source: null, setDate });
const marks = (stop: PriceMarks["stop"], tgt: PriceMarks["target"] = null, securityId = "s1"): PriceMarks => ({ securityId, stop, target: tgt });

describe("priceMarkState", () => {
  it("fixed stop below the latest Price: effective, distance, not breached", () => {
    const state = priceMarkState(marks(fixedStop("90")), [obs("2026-11-10", "100")], NO_CORPORATE_ACTIONS, TODAY);
    expect(state).toEqual({
      price: "100",
      priceDate: "2026-11-10",
      stop: { effective: "90", high: null, distance: "-0.1" },
      target: null,
      breached: "none",
    });
  });

  it("a stop equal to the latest Price is breached", () => {
    expect(priceMarkState(marks(fixedStop("100")), [obs("2026-11-10", "100")], NO_CORPORATE_ACTIONS, TODAY).breached).toBe("stop");
  });

  it("a target equal to the latest Price is reached", () => {
    const state = priceMarkState(marks(null, target("120")), [obs("2026-11-10", "120")], NO_CORPORATE_ACTIONS, TODAY);
    expect(state.breached).toBe("target");
    expect(state.target).toEqual({ price: "120", distance: "0" });
  });

  it("a target above the latest Price: distance positive, not reached", () => {
    const state = priceMarkState(marks(fixedStop("80"), target("125")), [obs("2026-11-10", "100")], NO_CORPORATE_ACTIONS, TODAY);
    expect(state.target).toEqual({ price: "125", distance: "0.25" });
    expect(state.breached).toBe("none");
  });

  it("a stop breach wins over a target", () => {
    const state = priceMarkState(marks(fixedStop("100"), target("90")), [obs("2026-11-10", "95")], NO_CORPORATE_ACTIONS, TODAY);
    expect(state.breached).toBe("stop");
  });

  it("trailing stop: high from closes after the set date, never falls", () => {
    const observations = [obs("2026-10-02", "110"), obs("2026-10-05", "120"), obs("2026-10-06", "105")];
    const state = priceMarkState(marks(trailingStop("10")), observations, NO_CORPORATE_ACTIONS, TODAY);
    expect(state.stop).toEqual({ effective: "108", high: "120", distance: ratio("108", "105") });
    expect(state.breached).toBe("stop");
  });

  it("trailing stop ignores higher closes before the set date but counts the Price in effect on it", () => {
    const observations = [obs("2026-09-20", "200"), obs("2026-09-30", "100"), obs("2026-10-02", "95")];
    const state = priceMarkState(marks(trailingStop("10")), observations, NO_CORPORATE_ACTIONS, TODAY);
    expect(state.stop?.high).toBe("100");
    expect(state.stop?.effective).toBe("90");
    expect(state.breached).toBe("none");
  });

  it("trailing stop set on a weekend gets the carried-forward Price as its high immediately", () => {
    const state = priceMarkState(marks(trailingStop("5", "2026-11-08")), [obs("2026-11-06", "100")], NO_CORPORATE_ACTIONS, TODAY);
    expect(state.stop).toEqual({ effective: "95", high: "100", distance: "-0.05" });
  });

  it("trailing stop counts a latest Transaction price above the closes", () => {
    const observations = [obs("2026-10-02", "100"), obs("2026-11-10", "130", "s1", "transaction")];
    const state = priceMarkState(marks(trailingStop("10")), observations, NO_CORPORATE_ACTIONS, TODAY);
    expect(state.stop?.high).toBe("130");
    expect(state.stop?.effective).toBe("117");
  });

  it("a split after the set date carries a fixed stop and target to today's units (no false breach)", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-10-15", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const state = priceMarkState(marks(fixedStop("90"), target("150")), [obs("2026-10-01", "100"), obs("2026-11-10", "50")], actions, TODAY);
    expect(state.stop?.effective).toBe("45");
    expect(state.target?.price).toBe("75");
    expect(state.breached).toBe("none");
  });

  it("a split after the set date keeps the trailing high in today's units", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-10-15", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const observations = [obs("2026-10-02", "120"), obs("2026-10-16", "58")];
    const state = priceMarkState(marks(trailingStop("10")), observations, actions, TODAY);
    expect(state.stop?.high).toBe("60");
    expect(state.stop?.effective).toBe("54");
    expect(state.breached).toBe("none");
  });

  it("without any Price: nothing to compare", () => {
    const state = priceMarkState(marks(trailingStop("10"), target("120")), [], NO_CORPORATE_ACTIONS, TODAY);
    expect(state).toEqual({
      price: null,
      priceDate: null,
      stop: { effective: null, high: null, distance: null },
      target: { price: "120", distance: null },
      breached: "none",
    });
  });

  it("without marks: only the latest Price", () => {
    expect(priceMarkState(marks(null), [obs("2026-11-10", "100")], NO_CORPORATE_ACTIONS, TODAY)).toEqual({
      price: "100",
      priceDate: "2026-11-10",
      stop: null,
      target: null,
      breached: "none",
    });
  });

  it("a latest Price of zero gives no distances", () => {
    const state = priceMarkState(marks(fixedStop("1"), target("2")), [obs("2026-11-10", "0")], NO_CORPORATE_ACTIONS, TODAY);
    expect(state.stop?.distance).toBeNull();
    expect(state.target?.distance).toBeNull();
    expect(state.breached).toBe("stop");
  });

  it("an ISIN change moves marks of the old Security to its successor (prices and ratio)", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "s1", newSecurityId: "s2", date: "2026-10-15", oldQuantity: "1", newQuantity: "2" }],
    };
    const observations = [obs("2026-10-01", "100", "s1"), obs("2026-11-10", "44", "s2")];
    const state = priceMarkState(marks(fixedStop("90"), target("150")), observations, actions, TODAY);
    expect(state.price).toBe("44");
    expect(state.stop?.effective).toBe("45");
    expect(state.target?.price).toBe("75");
    expect(state.breached).toBe("stop");
  });
});

function ratio(mark: string, latest: string): string {
  return ratioString(new ReturnDecimal(mark).dividedBy(latest).minus(1));
}

describe("checkPriceMarksPatch", () => {
  it("keeps omitted fields omitted and clears null ones", () => {
    expect(checkPriceMarksPatch({}, TODAY)).toEqual({ ok: true, patch: {} });
    expect(checkPriceMarksPatch({ stop: null, target: null }, TODAY)).toEqual({ ok: true, patch: { stop: null, target: null } });
  });

  it("canonicalises values, trims sources and defaults the date to today", () => {
    expect(
      checkPriceMarksPatch(
        { stop: { type: "TRAILING", value: "7.50", source: "  Börse Online  " }, target: { price: "245.00", source: "  ", setDate: "" } },
        TODAY,
      ),
    ).toEqual({
      ok: true,
      patch: {
        stop: { type: "TRAILING", value: "7.5", source: "Börse Online", setDate: TODAY },
        target: { price: "245", source: null, setDate: TODAY },
      },
    });
  });

  it("accepts trailing bounds 1 and 50 and a set date of today", () => {
    expect(checkPriceMarksPatch({ stop: { type: "TRAILING", value: "1", setDate: TODAY } }, TODAY).ok).toBe(true);
    expect(checkPriceMarksPatch({ stop: { type: "TRAILING", value: "50" } }, TODAY).ok).toBe(true);
  });

  it.each([
    [{ stop: { type: "FIXED", value: "abc" } }, "stopValue", "invalid"],
    [{ stop: { type: "FIXED", value: "0" } }, "stopValue", "not-positive"],
    [{ stop: { type: "FIXED", value: "-5" } }, "stopValue", "not-positive"],
    [{ stop: { type: "FIXED", value: "" } }, "stopValue", "required"],
    [{ stop: { type: "TRAILING", value: "60" } }, "stopValue", "out-of-range"],
    [{ stop: { type: "TRAILING", value: "0.5" } }, "stopValue", "out-of-range"],
    [{ stop: { type: "PERCENT", value: "5" } }, "stopType", "invalid"],
    [{ stop: { type: "FIXED", value: "5", source: "x".repeat(PRICE_MARK_SOURCE_MAX_LENGTH + 1) } }, "stopSource", "too-long"],
    [{ stop: { type: "FIXED", value: "5", setDate: "2026-11-12" } }, "stopSetDate", "future-date"],
    [{ stop: { type: "FIXED", value: "5", setDate: "2026-02-30" } }, "stopSetDate", "invalid"],
    [{ target: { price: "abc" } }, "targetPrice", "invalid"],
    [{ target: { price: "0" } }, "targetPrice", "not-positive"],
    [{ target: { price: "5", source: 42 } }, "targetSource", "invalid"],
    [{ target: { price: "5", setDate: "2027-01-01" } }, "targetSetDate", "future-date"],
  ])("refuses %j (%s %s)", (patch, field, problem) => {
    expect(checkPriceMarksPatch(patch as never, TODAY)).toEqual({ ok: false, reason: "price-marks-invalid", field, problem });
  });

  it("allows a 200-character source", () => {
    const source = "x".repeat(PRICE_MARK_SOURCE_MAX_LENGTH);
    expect(checkPriceMarksPatch({ target: { price: "5", source } }, TODAY)).toMatchObject({ ok: true, patch: { target: { source } } });
  });
});

describe("parsePriceMarksForm", () => {
  const empty: PriceMarksForm = { stopType: "", stopValue: "", stopSource: "", stopSetDate: "", targetPrice: "", targetSource: "", targetSetDate: "" };

  it("parses German decimals into a full patch", () => {
    expect(
      parsePriceMarksForm(
        { ...empty, stopType: "FIXED", stopValue: "1.234,50", stopSetDate: "2026-11-01", targetPrice: "245,00", targetSource: "Analyst" },
        TODAY,
      ),
    ).toEqual({
      ok: true,
      patch: {
        stop: { type: "FIXED", value: "1234.5", source: null, setDate: "2026-11-01" },
        target: { price: "245", source: "Analyst", setDate: TODAY },
      },
    });
  });

  it("clears both marks for an empty form (source and date of a cleared mark are ignored)", () => {
    expect(parsePriceMarksForm({ ...empty, stopValue: "5", targetSource: "x".repeat(300), targetSetDate: "2030-01-01" }, TODAY)).toEqual({
      ok: true,
      patch: { stop: null, target: null },
    });
  });

  it("parses a trailing percentage with a comma", () => {
    expect(parsePriceMarksForm({ ...empty, stopType: "TRAILING", stopValue: "7,5" }, TODAY)).toMatchObject({
      ok: true,
      patch: { stop: { type: "TRAILING", value: "7.5" } },
    });
  });

  it.each([
    [{ stopType: "FIXED", stopValue: "abc" }, "stopValue", "invalid"],
    [{ stopType: "FIXED", stopValue: "" }, "stopValue", "required"],
    [{ stopType: "FIXED", stopValue: "0" }, "stopValue", "not-positive"],
    [{ stopType: "TRAILING", stopValue: "60" }, "stopValue", "out-of-range"],
    [{ targetPrice: "1,2,3" }, "targetPrice", "invalid"],
    [{ targetPrice: "0,00" }, "targetPrice", "not-positive"],
    [{ targetPrice: "10", targetSetDate: "2026-11-12" }, "targetSetDate", "future-date"],
  ])("refuses %j", (fields, field, problem) => {
    expect(parsePriceMarksForm({ ...empty, ...fields }, TODAY)).toEqual({ ok: false, reason: "price-marks-invalid", field, problem });
  });
});

describe("priceMarkWarnings", () => {
  it("warns about a fixed stop above and a target below the latest Price", () => {
    expect(priceMarkWarnings({ stop: { type: "FIXED", value: "110" }, target: { price: "90" } }, "100")).toEqual([
      "stop-above-price",
      "target-below-price",
    ]);
  });

  it("does not warn at equality, for trailing stops or without a Price", () => {
    expect(priceMarkWarnings({ stop: { type: "FIXED", value: "100" }, target: { price: "100" } }, "100")).toEqual([]);
    expect(priceMarkWarnings({ stop: { type: "TRAILING", value: "10" } }, "5")).toEqual([]);
    expect(priceMarkWarnings({ stop: { type: "FIXED", value: "110" } }, null)).toEqual([]);
  });
});

describe("carryPriceMarks", () => {
  const actions: CorporateActions = {
    splits: [
      { securityId: "s1", date: "2026-10-05", ratioOld: "1", ratioNew: "2" },
      { securityId: "s2", date: "2026-10-20", ratioOld: "1", ratioNew: "4" },
    ],
    isinChanges: [{ oldSecurityId: "s1", newSecurityId: "s2", date: "2026-10-15", oldQuantity: "1", newQuantity: "1" }],
  };

  it("keeps the state unchanged when the marks move to the successor", () => {
    const original = marks(fixedStop("80"), target("200"));
    const moved = carryPriceMarks(original, "s2", actions, TODAY);
    expect(moved).toEqual({ securityId: "s2", stop: fixedStop("40"), target: target("100") });
    const observations = [obs("2026-11-10", "11", "s2")];
    expect(priceMarkState(moved, observations, actions, TODAY)).toEqual(priceMarkState(original, observations, actions, TODAY));
  });

  it("keeps a trailing percentage and the Security's own marks", () => {
    const own = marks(trailingStop("10"), null, "s2");
    expect(carryPriceMarks(own, "s2", actions, TODAY)).toBe(own);
    expect(carryPriceMarks(marks(trailingStop("10")), "s2", actions, TODAY).stop).toEqual(trailingStop("10"));
  });
});

describe("priceMarkLines", () => {
  const values = (lines: ReturnType<typeof priceMarkLines>) =>
    lines.stop?.kind === "trailing" ? lines.stop.points.map((point) => point.value) : undefined;

  it("no marks: no lines", () => {
    expect(priceMarkLines(null, [obs("2026-11-10", "100")], NO_CORPORATE_ACTIONS, "2026-11-01", TODAY)).toEqual({ stop: null, target: null });
  });

  it("fixed stop and target: horizontal levels", () => {
    const lines = priceMarkLines(marks(fixedStop("92.4"), target("245")), [obs("2026-11-10", "99.78")], NO_CORPORATE_ACTIONS, "2026-11-01", TODAY);
    expect(lines).toEqual({ stop: { kind: "fixed", value: "92.4" }, target: "245" });
  });

  it("trailing stop: running high from the set date, null before, never falls", () => {
    const observations = [obs("2026-09-30", "200"), obs("2026-10-01", "100"), obs("2026-10-02", "110"), obs("2026-10-03", "105")];
    const lines = priceMarkLines(marks(trailingStop("15")), observations, NO_CORPORATE_ACTIONS, "2026-09-30", "2026-10-04");
    expect(lines.stop?.kind).toBe("trailing");
    expect(lines.stop?.kind === "trailing" ? lines.stop.points.map((point) => point.date) : []).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(values(lines)).toEqual([null, "85", "93.5", "93.5", "93.5"]);
  });

  it("trailing stop: closes between the set date and the chart start count", () => {
    const observations = [obs("2026-10-01", "100"), obs("2026-10-05", "120"), obs("2026-10-20", "110")];
    const lines = priceMarkLines(marks(trailingStop("10")), observations, NO_CORPORATE_ACTIONS, "2026-10-19", "2026-10-20");
    expect(values(lines)).toEqual(["108", "108"]);
  });

  it("trailing stop without any Price: null points", () => {
    const lines = priceMarkLines(marks(trailingStop("10")), [], NO_CORPORATE_ACTIONS, "2026-10-01", "2026-10-02");
    expect(values(lines)).toEqual([null, null]);
  });

  it("marks set after the chart end are not drawn", () => {
    const lines = priceMarkLines(
      marks(trailingStop("10", "2026-11-05"), target("150", "2026-11-05")),
      [obs("2026-10-01", "100")],
      NO_CORPORATE_ACTIONS,
      "2026-10-01",
      "2026-10-31",
    );
    expect(lines).toEqual({ stop: null, target: null });
    expect(priceMarkLines(marks(fixedStop("90", "2026-11-05")), [], NO_CORPORATE_ACTIONS, "2026-10-01", "2026-10-31").stop).toBeNull();
  });

  it("a split in the chart range: fixed stop and target in the units as of the chart end", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-10-15", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const observations = [obs("2026-10-01", "100"), obs("2026-10-20", "50")];
    expect(priceMarkLines(marks(fixedStop("90"), target("150")), observations, actions, "2026-10-01", "2026-10-31")).toEqual({
      stop: { kind: "fixed", value: "45" },
      target: "75",
    });
    // Before the split the chart is in the old units.
    expect(priceMarkLines(marks(fixedStop("90")), observations, actions, "2026-10-01", "2026-10-10").stop).toEqual({ kind: "fixed", value: "90" });
  });

  it("with the chart end today the last trailing point equals the state's effective stop", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-10-15", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const observations = [
      obs("2026-09-20", "300"),
      obs("2026-10-01", "100"),
      obs("2026-10-02", "120"),
      obs("2026-10-16", "58"),
      obs("2026-11-10", "70", "s1", "manual"),
      obs("2026-11-11", "64", "s1", "transaction"),
    ];
    const own = marks(trailingStop("12.5"));
    const lines = priceMarkLines(own, observations, actions, "2026-09-01", TODAY);
    const points = lines.stop?.kind === "trailing" ? lines.stop.points : [];
    expect(points.at(-1)).toEqual({ date: TODAY, value: priceMarkState(own, observations, actions, TODAY).stop?.effective });
    expect(points.at(-1)?.value).toBe("61.25");
  });
});
