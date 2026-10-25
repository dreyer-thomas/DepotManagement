import { describe, expect, it } from "vitest";
import { type PriceObservation, resolvePrice } from "./prices";

const obs = (id: string, date: string, sequence: number, price: string, securityId = "s1"): PriceObservation => ({
  id,
  securityId,
  date,
  sequence,
  price,
});

describe("resolvePrice", () => {
  it("is null without an observation on or before the date", () => {
    expect(resolvePrice([], "s1", "2026-10-25")).toBeNull();
    expect(resolvePrice([obs("a", "2026-10-26", 1, "5")], "s1", "2026-10-25")).toBeNull();
    expect(resolvePrice([obs("a", "2026-10-01", 1, "5", "other")], "s1", "2026-10-25")).toBeNull();
  });

  it("uses the latest observation of any Depot and ignores future rows", () => {
    const observations = [
      obs("a", "2026-10-01", 1, "100"),
      obs("b", "2026-10-20", 1, "130"),
      obs("c", "2026-10-30", 1, "999"),
      obs("d", "2026-10-10", 5, "110"),
    ];
    expect(resolvePrice(observations, "s1", "2026-10-25")).toEqual({ price: "130", date: "2026-10-20" });
  });

  it("counts an observation on the date itself", () => {
    expect(resolvePrice([obs("a", "2026-10-25", 1, "7")], "s1", "2026-10-25")).toEqual({ price: "7", date: "2026-10-25" });
  });

  it("breaks ties by sequence, then by id", () => {
    const sameDate = [obs("b", "2026-10-20", 2, "2"), obs("a", "2026-10-20", 3, "3"), obs("z", "2026-10-20", 1, "1")];
    expect(resolvePrice(sameDate, "s1", "2026-10-25")?.price).toBe("3");
    const crossDepot = [obs("y", "2026-10-20", 1, "20"), obs("x", "2026-10-20", 1, "10")];
    expect(resolvePrice(crossDepot, "s1", "2026-10-25")?.price).toBe("20");
    expect(resolvePrice([...crossDepot].reverse(), "s1", "2026-10-25")?.price).toBe("20");
  });
});
