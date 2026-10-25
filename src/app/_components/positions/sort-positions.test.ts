import { describe, expect, it } from "vitest";
import { initialSortDirection, nextSort, selectSortKey, sortPositions, toggleSortDirection } from "./sort-positions";

type Row = Parameters<typeof sortPositions>[0][number];

const row = (name: string, value: string | null, quantity = "1"): Row => ({
  security: { id: name, name },
  quantity,
  costBasis: "10",
  averagePrice: "10",
  price: value,
  value,
  gain: value,
});

const names = (rows: Row[]) => rows.map((r) => r.security.name);

describe("sortPositions", () => {
  const rows = [row("Beta", "9.5"), row("alpha", null), row("Äpfel AG", "100"), row("Gamma", "10")];

  it("sorts decimals exactly, not as strings, with nulls last in both directions", () => {
    expect(names(sortPositions(rows, "value", "desc"))).toEqual(["Äpfel AG", "Gamma", "Beta", "alpha"]);
    expect(names(sortPositions(rows, "value", "asc"))).toEqual(["Beta", "Gamma", "Äpfel AG", "alpha"]);
  });

  it("sorts names with German collation (umlauts next to their base letter)", () => {
    const rows = [row("Zeta", "1"), row("Beta", "1"), row("Äpfel AG", "1"), row("alpha", "1"), row("Gamma", "1")];
    expect(names(sortPositions(rows, "name", "asc"))).toEqual(["alpha", "Äpfel AG", "Beta", "Gamma", "Zeta"]);
    expect(names(sortPositions(rows, "name", "desc"))).toEqual(["Zeta", "Gamma", "Beta", "Äpfel AG", "alpha"]);
  });

  it("compares fractional quantities and breaks ties by name", () => {
    const fractional = [row("B", "1", "0.00012345"), row("A", "1", "0.0001"), row("C", "1", "0.0001")];
    expect(names(sortPositions(fractional, "quantity", "desc"))).toEqual(["B", "A", "C"]);
  });

  it("does not mutate the input", () => {
    const copy = [...rows];
    sortPositions(rows, "value", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("sort state", () => {
  it("starts names ascending and figures descending", () => {
    expect(initialSortDirection("name")).toBe("asc");
    expect(initialSortDirection("value")).toBe("desc");
    expect(initialSortDirection("gain")).toBe("desc");
  });

  it("toggles the direction on repeated header clicks and starts a new key in its initial direction", () => {
    const first = nextSort({ key: "value", direction: "desc" }, "value");
    expect(first).toEqual({ key: "value", direction: "asc" });
    expect(nextSort(first, "value")).toEqual({ key: "value", direction: "desc" });
    expect(nextSort(first, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "name", direction: "desc" }, "price")).toEqual({ key: "price", direction: "desc" });
  });

  it("resets the direction when the phone select picks a key", () => {
    expect(selectSortKey("name")).toEqual({ key: "name", direction: "asc" });
    expect(selectSortKey("value")).toEqual({ key: "value", direction: "desc" });
  });

  it("flips only the direction with the phone toggle", () => {
    expect(toggleSortDirection({ key: "gain", direction: "desc" })).toEqual({ key: "gain", direction: "asc" });
    expect(toggleSortDirection({ key: "gain", direction: "asc" })).toEqual({ key: "gain", direction: "desc" });
  });
});
