import { describe, expect, it, vi } from "vitest";
import { EXPORT_SCHEMA_VERSION } from "./schema";
import { UPGRADES, upgradeExport } from "./upgrade";

describe("upgradeExport", () => {
  it("upgrades a version-1 document to version 6 with no classifications, tax settings, target allocations or watchlists", () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(6);
    expect(Object.keys(UPGRADES)).toEqual(["1", "2", "3", "4", "5"]);
    expect(upgradeExport({ schemaVersion: 1, depots: [] })).toEqual({
      ok: true,
      document: { schemaVersion: 6, depots: [], classifications: [], taxAllowances: [], teilfreistellungOverrides: [], targetAllocations: [], watchlists: [] },
    });
  });

  it("upgrades a version-2 document to version 6 with no tax settings", () => {
    expect(upgradeExport({ schemaVersion: 2, depots: [], classifications: [] })).toEqual({
      ok: true,
      document: { schemaVersion: 6, depots: [], classifications: [], taxAllowances: [], teilfreistellungOverrides: [], targetAllocations: [], watchlists: [] },
    });
  });

  it("upgrades a version-3 document to version 6 with no manual region split per classification", () => {
    const classification = { id: "k1", securityId: "s1", assetClass: null, sector: "Halbleiter", region: "Europa" };
    expect(upgradeExport({ schemaVersion: 3, depots: [], classifications: [classification], taxAllowances: [] })).toEqual({
      ok: true,
      document: { schemaVersion: 6, depots: [], classifications: [{ ...classification, regionSplit: null }], taxAllowances: [], targetAllocations: [], watchlists: [] },
    });
    // A malformed classifications value is passed on for the schema to reject.
    expect(upgradeExport({ schemaVersion: 3, classifications: "x" })).toEqual({ ok: true, document: { schemaVersion: 6, classifications: "x", targetAllocations: [], watchlists: [] } });
  });

  it("upgrades a version-4 document to version 6 with no target allocations or watchlists", () => {
    const raw = { schemaVersion: 4, depots: [], classifications: [], taxAllowances: [], teilfreistellungOverrides: [] };
    expect(upgradeExport(raw)).toEqual({ ok: true, document: { ...raw, schemaVersion: 6, targetAllocations: [], watchlists: [] } });
  });

  it("upgrades a version-5 document to version 6 with no watchlists, without touching the input", () => {
    const raw = { schemaVersion: 5, depots: [], classifications: [], taxAllowances: [], teilfreistellungOverrides: [], targetAllocations: [] };
    const copy = structuredClone(raw);
    expect(upgradeExport(raw)).toEqual({ ok: true, document: { ...raw, schemaVersion: 6, watchlists: [] } });
    expect(UPGRADES[5](raw)).toEqual({ ...raw, schemaVersion: 6, watchlists: [] });
    expect(raw).toEqual(copy);
  });

  it("returns a current-version document unchanged", () => {
    const raw = { schemaVersion: 6, depots: [], classifications: [], taxAllowances: [], teilfreistellungOverrides: [], targetAllocations: [], watchlists: [] };
    expect(upgradeExport(raw)).toEqual({ ok: true, document: raw });
  });

  it("runs an older document through the chain to the target, one step per version", () => {
    const step = vi.fn((document: Record<string, unknown>) => ({ ...document, schemaVersion: 2, upgraded: true }));
    const result = upgradeExport({ schemaVersion: 1, depots: [] }, { 1: step }, 2);
    expect(result).toEqual({ ok: true, document: { schemaVersion: 2, depots: [], upgraded: true } });
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("chains several steps in order", () => {
    const calls: number[] = [];
    const upgrades = {
      1: (d: Record<string, unknown>) => (calls.push(1), { ...d, schemaVersion: 2 }),
      2: (d: Record<string, unknown>) => (calls.push(2), { ...d, schemaVersion: 3 }),
    };
    expect(upgradeExport({ schemaVersion: 1 }, upgrades, 3)).toEqual({ ok: true, document: { schemaVersion: 3 } });
    expect(calls).toEqual([1, 2]);
  });

  it("rejects a newer version as unsupported", () => {
    expect(upgradeExport({ schemaVersion: 7 })).toEqual({ ok: false, reason: "version-unsupported" });
  });

  it.each([
    ["a missing version", {}],
    ["a string version", { schemaVersion: "1" }],
    ["a fractional version", { schemaVersion: 1.5 }],
    ["version 0", { schemaVersion: 0 }],
    ["a negative version", { schemaVersion: -1 }],
  ])("rejects %s as schema-invalid", (_label, raw) => {
    expect(upgradeExport(raw)).toEqual({ ok: false, reason: "schema-invalid", detail: "schemaVersion" });
  });

  it.each([["an array", []], ["null", null], ["a string", "abc"], ["a number", 1]])("rejects %s as schema-invalid", (_label, raw) => {
    expect(upgradeExport(raw)).toEqual({ ok: false, reason: "schema-invalid" });
  });

  it("rejects a version without an upgrade step and a throwing step", () => {
    expect(upgradeExport({ schemaVersion: 1 }, {}, 2)).toMatchObject({ ok: false, reason: "schema-invalid" });
    const throwing = () => {
      throw new Error("boom");
    };
    expect(upgradeExport({ schemaVersion: 1 }, { 1: throwing }, 2)).toEqual({ ok: false, reason: "schema-invalid" });
  });
});
