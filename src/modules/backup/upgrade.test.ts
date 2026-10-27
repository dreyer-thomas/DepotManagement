import { describe, expect, it, vi } from "vitest";
import { EXPORT_SCHEMA_VERSION } from "./schema";
import { UPGRADES, upgradeExport } from "./upgrade";

describe("upgradeExport", () => {
  it("upgrades a version-1 document to version 2 with no classifications", () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(2);
    expect(Object.keys(UPGRADES)).toEqual(["1"]);
    expect(upgradeExport({ schemaVersion: 1, depots: [] })).toEqual({
      ok: true,
      document: { schemaVersion: 2, depots: [], classifications: [] },
    });
  });

  it("returns a current-version document unchanged", () => {
    const raw = { schemaVersion: 2, depots: [], classifications: [] };
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
    expect(upgradeExport({ schemaVersion: 3 })).toEqual({ ok: false, reason: "version-unsupported" });
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
