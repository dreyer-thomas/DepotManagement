import { describe, expect, it } from "vitest";
import { type PriceObservation, type PriceSource, resolvePrice } from "./prices";

const obs = (
  id: string,
  date: string,
  sequence: number,
  price: string,
  securityId = "s1",
  source: PriceSource = "transaction",
): PriceObservation => ({ id, securityId, date, sequence, price, source });

const stored = (id: string, date: string, price: string, source: "manual" | "provider", securityId = "s1") =>
  obs(id, date, 0, price, securityId, source);

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

describe("resolvePrice precedence (manual > provider > Transaction)", () => {
  const buy = obs("t", "2026-10-20", 3, "100");
  const provider = stored("p", "2026-10-20", "101", "provider");
  const manual = stored("m", "2026-10-20", "102", "manual");

  it("prefers a manual Price on the same date, regardless of order", () => {
    expect(resolvePrice([buy, provider, manual], "s1", "2026-10-25")).toEqual({ price: "102", date: "2026-10-20" });
    expect(resolvePrice([manual, provider, buy], "s1", "2026-10-25")).toEqual({ price: "102", date: "2026-10-20" });
  });

  it("prefers a provider Price over a Transaction price on the same date", () => {
    expect(resolvePrice([buy, provider], "s1", "2026-10-25")).toEqual({ price: "101", date: "2026-10-20" });
    expect(resolvePrice([provider, buy], "s1", "2026-10-25")).toEqual({ price: "101", date: "2026-10-20" });
  });

  it("uses the Transaction price without a stored Price on that date", () => {
    expect(resolvePrice([buy], "s1", "2026-10-25")).toEqual({ price: "100", date: "2026-10-20" });
  });

  it("carries forward the latest earlier observation, a later date beating a higher-ranked source", () => {
    const earlierManual = stored("m0", "2026-10-15", "90", "manual");
    const laterProvider = stored("p1", "2026-10-22", "105", "provider");
    expect(resolvePrice([earlierManual, buy, laterProvider], "s1", "2026-10-25")).toEqual({ price: "105", date: "2026-10-22" });
    expect(resolvePrice([earlierManual, buy, laterProvider], "s1", "2026-10-21")).toEqual({ price: "100", date: "2026-10-20" });
    expect(resolvePrice([earlierManual, buy, laterProvider], "s1", "2026-10-19")).toEqual({ price: "90", date: "2026-10-15" });
  });
});
