import { describe, expect, it } from "vitest";
import { NO_CORPORATE_ACTIONS, type CorporateActions } from "./corporate-actions";
import type { PriceObservation, PriceSource } from "./prices";
import {
  currentSecurityId,
  entryFigures,
  firstNoteLine,
  isValidDateAdded,
  sortWatchlistEntries,
  type SortableWatchlistEntry,
  WATCHLIST_NAME_MAX_LENGTH,
  WATCHLIST_NOTE_MAX_LENGTH,
  watchlistHistoryStart,
} from "./watchlist";

let nextId = 0;
const obs = (date: string, price: string, source: PriceSource = "provider", securityId = "s1"): PriceObservation => ({
  id: `o${++nextId}`,
  securityId,
  date,
  sequence: 0,
  price,
  source,
  fetchedAt: source === "transaction" ? null : `${date}T18:00:00.000Z`,
  provider: source === "provider" ? "YAHOO" : null,
});

describe("limits", () => {
  it("allows 60-character names and 2000-character notes", () => {
    expect(WATCHLIST_NAME_MAX_LENGTH).toBe(60);
    expect(WATCHLIST_NOTE_MAX_LENGTH).toBe(2000);
  });
});

describe("currentSecurityId", () => {
  it("follows an ISIN change dated on or before today, else keeps the Security", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "s1", newSecurityId: "s2", date: "2026-10-15", oldQuantity: "1", newQuantity: "1" }],
    };
    expect(currentSecurityId("s1", actions, "2026-10-28")).toBe("s2");
    expect(currentSecurityId("s1", actions, "2026-10-14")).toBe("s1");
    expect(currentSecurityId("s3", actions, "2026-10-28")).toBe("s3");
  });
});

describe("entryFigures", () => {
  it("has no Price, no changes and no stale flag without any observation", () => {
    expect(entryFigures([], "s1", NO_CORPORATE_ACTIONS, "2026-10-01", "2026-10-28")).toEqual({
      price: null,
      priceDate: null,
      priceSource: null,
      priceFetchedAt: null,
      priceProvider: null,
      stale: false,
      changeToday: null,
      sinceAdded: null,
    });
  });

  it("computes change today against the previous day's Price and change since added", () => {
    const figures = entryFigures(
      [obs("2026-10-01", "80"), obs("2026-10-26", "100"), obs("2026-10-27", "110")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-01",
      "2026-10-28",
    );
    expect(figures).toMatchObject({
      price: "110",
      priceDate: "2026-10-27",
      priceSource: "provider",
      priceProvider: "YAHOO",
      priceFetchedAt: "2026-10-27T18:00:00.000Z",
      stale: false,
      changeToday: { perUnit: "10", ratio: "0.1" },
      sinceAdded: "0.375",
    });
  });

  it("shows the last trading day's move on a weekend (carry-forward to the day before the Price date)", () => {
    // Friday 2026-10-23 close vs. Thursday's; viewed on Sunday 2026-10-25.
    const figures = entryFigures(
      [obs("2026-10-21", "50"), obs("2026-10-23", "55")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-21",
      "2026-10-25",
    );
    expect(figures.changeToday).toEqual({ perUnit: "5", ratio: "0.1" });
  });

  it("has no change today without a previous Price", () => {
    const figures = entryFigures([obs("2026-10-27", "110")], "s1", NO_CORPORATE_ACTIONS, "2026-10-27", "2026-10-28");
    expect(figures.changeToday).toBeNull();
    expect(figures.sinceAdded).toBe("0");
  });

  it("carries the Price forward to the date added", () => {
    const figures = entryFigures(
      [obs("2026-10-20", "40"), obs("2026-10-27", "50")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-24",
      "2026-10-28",
    );
    expect(figures.sinceAdded).toBe("0.25");
  });

  it("has no change since added without a Price on or before the date added", () => {
    const figures = entryFigures([obs("2026-10-27", "50")], "s1", NO_CORPORATE_ACTIONS, "2026-10-20", "2026-10-28");
    expect(figures.price).toBe("50");
    expect(figures.sinceAdded).toBeNull();
  });

  it("has no change since added or today when the base Price is zero", () => {
    const figures = entryFigures(
      [obs("2026-10-20", "0"), obs("2026-10-27", "50")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-20",
      "2026-10-28",
    );
    expect(figures.sinceAdded).toBeNull();
    expect(figures.changeToday).toBeNull();
  });

  it("has no change since added when today's Price is zero", () => {
    const figures = entryFigures(
      [obs("2026-10-20", "10"), obs("2026-10-27", "0")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-20",
      "2026-10-28",
    );
    expect(figures.sinceAdded).toBeNull();
  });

  it("is neutral to a split after the date added (unadjusted stored Prices 100 → 26 over a 1:4 split)", () => {
    const actions: CorporateActions = {
      splits: [{ securityId: "s1", date: "2026-10-15", ratioOld: "1", ratioNew: "4" }],
      isinChanges: [],
    };
    const figures = entryFigures(
      [obs("2026-10-01", "100"), obs("2026-10-27", "26")],
      "s1",
      actions,
      "2026-10-01",
      "2026-10-28",
    );
    expect(figures.price).toBe("26");
    expect(figures.sinceAdded).toBe("0.04");
  });

  it("follows the resolver precedence: manual over provider on the same date", () => {
    const figures = entryFigures(
      [obs("2026-10-27", "100"), obs("2026-10-27", "105", "manual"), obs("2026-10-26", "90", "transaction")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-26",
      "2026-10-28",
    );
    expect(figures).toMatchObject({ price: "105", priceSource: "manual", priceProvider: null });
    expect(Number(figures.sinceAdded)).toBeCloseTo(105 / 90 - 1, 12);
  });

  it("flags a stale latest Price (older than 3 days)", () => {
    expect(entryFigures([obs("2026-10-22", "10")], "s1", NO_CORPORATE_ACTIONS, "2026-10-22", "2026-10-26").stale).toBe(true);
    expect(entryFigures([obs("2026-10-23", "10")], "s1", NO_CORPORATE_ACTIONS, "2026-10-23", "2026-10-26").stale).toBe(false);
  });

  it("ignores Prices of other Securities and dated after today", () => {
    const figures = entryFigures(
      [obs("2026-10-20", "10"), obs("2026-10-27", "99", "provider", "s2"), obs("2026-10-29", "99")],
      "s1",
      NO_CORPORATE_ACTIONS,
      "2026-10-20",
      "2026-10-28",
    );
    expect(figures.price).toBe("10");
  });

  it("follows an ISIN change to the new Security", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "s1", newSecurityId: "s2", date: "2026-10-15", oldQuantity: "1", newQuantity: "1" }],
    };
    const figures = entryFigures(
      [obs("2026-10-01", "100"), obs("2026-10-27", "120", "provider", "s2")],
      "s1",
      actions,
      "2026-10-01",
      "2026-10-28",
    );
    expect(figures).toMatchObject({ price: "120", sinceAdded: "0.2" });
  });
});

const row = (
  id: string,
  name: string,
  dateAdded: string,
  changeToday: string | null,
  sinceAdded: string | null,
): SortableWatchlistEntry => ({ id, dateAdded, changeToday: changeToday === null ? null : { ratio: changeToday }, sinceAdded, security: { name } });

describe("sortWatchlistEntries", () => {
  const rows = [
    row("e1", "SAP SE", "2026-10-01", "0.01", "0.2"),
    row("e2", "Apple", "2026-10-20", null, null),
    row("e3", "Bayer", "2026-10-20", "-0.02", "-0.1"),
    row("e4", "Allianz", "2026-09-01", "0.03", null),
  ];
  const ids = (sorted: SortableWatchlistEntry[]) => sorted.map((entry) => entry.id);

  it("defaults to date added newest first, ties by name", () => {
    expect(ids(sortWatchlistEntries(rows))).toEqual(["e2", "e3", "e1", "e4"]);
  });

  it("sorts by date added ascending with the name tie-break kept", () => {
    expect(ids(sortWatchlistEntries(rows, "dateAdded", "asc"))).toEqual(["e4", "e1", "e2", "e3"]);
  });

  it("sorts by name in both directions", () => {
    expect(ids(sortWatchlistEntries(rows, "name", "asc"))).toEqual(["e4", "e2", "e3", "e1"]);
    expect(ids(sortWatchlistEntries(rows, "name", "desc"))).toEqual(["e1", "e3", "e2", "e4"]);
  });

  it("sorts change today with nulls last in both directions", () => {
    expect(ids(sortWatchlistEntries(rows, "changeToday", "desc"))).toEqual(["e4", "e1", "e3", "e2"]);
    expect(ids(sortWatchlistEntries(rows, "changeToday", "asc"))).toEqual(["e3", "e1", "e4", "e2"]);
  });

  it("sorts change since added with nulls last in both directions, null ties by name", () => {
    expect(ids(sortWatchlistEntries(rows, "sinceAdded", "desc"))).toEqual(["e1", "e3", "e4", "e2"]);
    expect(ids(sortWatchlistEntries(rows, "sinceAdded", "asc"))).toEqual(["e3", "e1", "e4", "e2"]);
  });

  it("breaks name ties by id and never mutates the input", () => {
    const same = [row("b", "X", "2026-10-01", null, null), row("a", "X", "2026-10-01", null, null)];
    expect(ids(sortWatchlistEntries(same, "name", "desc"))).toEqual(["a", "b"]);
    expect(ids(same)).toEqual(["b", "a"]);
  });
});

describe("watchlistHistoryStart", () => {
  it("starts 10 days before the 3J preset start when the earliest date added is later", () => {
    expect(watchlistHistoryStart("2026-10-01", "2026-10-23")).toBe("2023-10-13");
  });

  it("starts 10 days before an earlier date added", () => {
    expect(watchlistHistoryStart("2020-01-11", "2026-10-23")).toBe("2020-01-01");
  });
});

describe("isValidDateAdded", () => {
  it("accepts business dates up to today and refuses the future and invalid dates", () => {
    expect(isValidDateAdded("2026-10-28", "2026-10-28")).toBe(true);
    expect(isValidDateAdded("2026-10-29", "2026-10-28")).toBe(false);
    expect(isValidDateAdded("2026-02-31", "2026-10-28")).toBe(false);
    expect(isValidDateAdded("31.02.", "2026-10-28")).toBe(false);
    expect(isValidDateAdded(undefined, "2026-10-28")).toBe(false);
  });
});

describe("firstNoteLine", () => {
  it("returns the first non-blank line, trimmed", () => {
    expect(firstNoteLine("")).toBe("");
    expect(firstNoteLine("\n  \n  Idee: KGV niedrig \nzweite Zeile")).toBe("Idee: KGV niedrig");
    expect(firstNoteLine("eine\r\nzwei")).toBe("eine");
  });
});
