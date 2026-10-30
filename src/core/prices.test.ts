import { describe, expect, it } from "vitest";
import { isStale, type PriceObservation, type PriceSource, resolvePrice, STALE_AFTER_DAYS } from "./prices";

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
    expect(resolvePrice(observations, "s1", "2026-10-25")).toMatchObject({ price: "130", date: "2026-10-20" });
  });

  it("counts an observation on the date itself", () => {
    expect(resolvePrice([obs("a", "2026-10-25", 1, "7")], "s1", "2026-10-25")).toMatchObject({ price: "7", date: "2026-10-25" });
  });

  it("breaks ties by sequence, then by id", () => {
    const sameDate = [obs("b", "2026-10-20", 2, "2"), obs("a", "2026-10-20", 3, "3"), obs("z", "2026-10-20", 1, "1")];
    expect(resolvePrice(sameDate, "s1", "2026-10-25")?.price).toBe("3");
    const crossDepot = [obs("y", "2026-10-20", 1, "20"), obs("x", "2026-10-20", 1, "10")];
    expect(resolvePrice(crossDepot, "s1", "2026-10-25")?.price).toBe("20");
    expect(resolvePrice([...crossDepot].reverse(), "s1", "2026-10-25")?.price).toBe("20");
  });
});

describe("resolvePrice precedence (provider > manual > Transaction)", () => {
  const buy = obs("t", "2026-10-20", 3, "100");
  const provider = stored("p", "2026-10-20", "101", "provider");
  const manual = stored("m", "2026-10-20", "102", "manual");

  it("prefers a provider Price over a manual one on the same date, regardless of order", () => {
    expect(resolvePrice([buy, provider, manual], "s1", "2026-10-25")).toMatchObject({ price: "101", date: "2026-10-20", source: "provider" });
    expect(resolvePrice([manual, provider, buy], "s1", "2026-10-25")).toMatchObject({ price: "101", date: "2026-10-20", source: "provider" });
  });

  it("prefers a manual Price over a Transaction price on the same date, and a newer manual Price over an older provider one", () => {
    expect(resolvePrice([buy, manual], "s1", "2026-10-25")).toMatchObject({ price: "102", source: "manual" });
    const laterManual = stored("m1", "2026-10-23", "103", "manual");
    expect(resolvePrice([provider, laterManual], "s1", "2026-10-25")).toMatchObject({ price: "103", date: "2026-10-23", source: "manual" });
  });

  it("prefers a provider Price over a Transaction price on the same date", () => {
    expect(resolvePrice([buy, provider], "s1", "2026-10-25")).toMatchObject({ price: "101", date: "2026-10-20" });
    expect(resolvePrice([provider, buy], "s1", "2026-10-25")).toMatchObject({ price: "101", date: "2026-10-20" });
  });

  it("uses the Transaction price without a stored Price on that date", () => {
    expect(resolvePrice([buy], "s1", "2026-10-25")).toMatchObject({ price: "100", date: "2026-10-20" });
  });

  it("carries forward the latest earlier observation, a later date beating a higher-ranked source", () => {
    const earlierManual = stored("m0", "2026-10-15", "90", "manual");
    const laterProvider = stored("p1", "2026-10-22", "105", "provider");
    expect(resolvePrice([earlierManual, buy, laterProvider], "s1", "2026-10-25")).toMatchObject({ price: "105", date: "2026-10-22" });
    expect(resolvePrice([earlierManual, buy, laterProvider], "s1", "2026-10-21")).toMatchObject({ price: "100", date: "2026-10-20" });
    expect(resolvePrice([earlierManual, buy, laterProvider], "s1", "2026-10-19")).toMatchObject({ price: "90", date: "2026-10-15" });
  });
});

describe("resolvePrice source data", () => {
  it("carries source, fetch time and provider of the winning observation", () => {
    const provider: PriceObservation = {
      ...obs("p", "2026-10-22", 0, "101", "s1", "provider"),
      fetchedAt: "2026-10-22T18:00:00.000Z",
      provider: "YAHOO",
    };
    expect(resolvePrice([provider], "s1", "2026-10-25")).toEqual({
      price: "101",
      date: "2026-10-22",
      source: "provider",
      fetchedAt: "2026-10-22T18:00:00.000Z",
      provider: "YAHOO",
    });
    expect(resolvePrice([obs("t", "2026-10-20", 1, "100")], "s1", "2026-10-25")).toEqual({
      price: "100",
      date: "2026-10-20",
      source: "transaction",
      fetchedAt: null,
      provider: null,
    });
  });
});

describe("isStale", () => {
  it("is true only when today is more than 3 calendar days after the price date", () => {
    expect(STALE_AFTER_DAYS).toBe(3);
    expect(isStale("2026-10-22", "2026-10-26")).toBe(true);
    expect(isStale("2026-10-23", "2026-10-26")).toBe(false);
    expect(isStale("2026-10-24", "2026-10-26")).toBe(false);
    expect(isStale("2026-10-26", "2026-10-26")).toBe(false);
  });

  it("counts calendar days across month and year ends", () => {
    expect(isStale("2026-12-29", "2027-01-01")).toBe(false);
    expect(isStale("2026-12-28", "2027-01-01")).toBe(true);
    expect(isStale("2024-02-27", "2024-03-01")).toBe(false);
    expect(isStale("2024-02-26", "2024-03-01")).toBe(true);
  });
});
