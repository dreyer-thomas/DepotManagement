import { describe, expect, it } from "vitest";
import type { TransactionProposal } from "./proposal";
import {
  candidateSecurityId,
  classifyBatch,
  effectiveDecision,
  itemReviewStatus,
  proposalKey,
  readDecisions,
  type ReviewLedgerRow,
  reviewCounts,
} from "./review";

const DEPOT = "d1";
const ISIN = "IE00BK5BQT80";
const BUY: TransactionProposal = {
  type: "BUY",
  date: "2026-10-15",
  isin: ISIN,
  name: "Beispiel ETF",
  quantity: "3.412871",
  price: "43.95",
  amount: "150",
  fee: "0",
  tax: "0",
};

const row = (id: string, overrides: Partial<ReviewLedgerRow> = {}): ReviewLedgerRow => ({
  id,
  depotId: DEPOT,
  date: "2026-10-15",
  type: "BUY",
  securityId: "sec-1",
  quantity: "3.412871",
  amount: "150",
  fee: "0",
  tax: "0",
  ...overrides,
});

const stored = new Map([[ISIN, "sec-1"]]);

describe("classifyBatch", () => {
  it("marks a proposal without matches unique", () => {
    const result = classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], [], stored, []);
    expect(result[0]?.[0]).toEqual({ status: "unique", ledgerMatches: [], siblingMatch: false });
  });

  it("marks exactly one ledger match duplicate, also within €0.01", () => {
    const ledger = [row("t1", { amount: "150.01" })];
    const result = classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], ledger, stored, []);
    expect(result[0]?.[0]).toEqual({ status: "duplicate", ledgerMatches: ledger, siblingMatch: false });
    const beyond = classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], [row("t1", { amount: "150.02" })], stored, []);
    expect(beyond[0]?.[0]?.status).toBe("unique");
  });

  it("marks two ledger matches ambiguous with both listed", () => {
    const ledger = [row("t1"), row("t2")];
    const result = classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], ledger, stored, []);
    expect(result[0]?.[0]).toEqual({ status: "ambiguous", ledgerMatches: ledger, siblingMatch: false });
  });

  it("marks identical proposals of the batch ambiguous even on an empty ledger (savings plan)", () => {
    const result = classifyBatch(
      DEPOT,
      [
        { id: "i1", status: "PARSED", proposals: [BUY] },
        { id: "i2", status: "PARSED", proposals: [BUY] },
      ],
      [],
      new Map(),
      [],
    );
    expect(result.map((item) => item.map((proposal) => [proposal.status, proposal.siblingMatch]))).toEqual([
      [["ambiguous", true]],
      [["ambiguous", true]],
    ]);
  });

  it("finds siblings within one item and makes a sibling plus one ledger match ambiguous", () => {
    const result = classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY, BUY] }], [row("t1")], stored, []);
    expect(result[0]?.map((proposal) => [proposal.status, proposal.ledgerMatches.length, proposal.siblingMatch])).toEqual([
      ["ambiguous", 1, true],
      ["ambiguous", 1, true],
    ]);
  });

  it("never matches a ledger row for an ISIN without a stored Security", () => {
    const ledger = [row("t1", { securityId: "sec-other" })];
    expect(classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], ledger, new Map(), [])[0]?.[0]?.status).toBe("unique");
    expect(candidateSecurityId(ISIN, new Map())).toBe(`isin:${ISIN}`);
    expect(candidateSecurityId(undefined, stored)).toBeNull();
  });

  it("resolves an old ISIN to its successor (ISIN change → duplicate)", () => {
    const ledger = [row("t1", { securityId: "sec-new" })];
    const changes = [{ oldSecurityId: "sec-1", newSecurityId: "sec-new", date: "2026-01-01", oldQuantity: "1", newQuantity: "1" }];
    const result = classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], ledger, stored, changes);
    expect(result[0]?.[0]?.status).toBe("duplicate");
  });

  it("differs on Depot, type, date, quantity and Security", () => {
    const ledger = [
      row("a", { depotId: "other" }),
      row("b", { type: "SELL" }),
      row("c", { date: "2026-10-16" }),
      row("d", { quantity: "3.412872" }),
      row("e", { securityId: "sec-2" }),
    ];
    expect(classifyBatch(DEPOT, [{ id: "i1", status: "PARSED", proposals: [BUY] }], ledger, stored, [])[0]?.[0]?.status).toBe("unique");
  });

  it("gives FAILED items no classifications and ignores them as siblings", () => {
    const result = classifyBatch(
      DEPOT,
      [
        { id: "i1", status: "FAILED", proposals: [BUY] },
        { id: "i2", status: "PARSED", proposals: [BUY] },
      ],
      [],
      stored,
      [],
    );
    expect(result[0]).toEqual([]);
    expect(result[1]?.[0]?.status).toBe("unique");
  });
});

describe("effectiveDecision", () => {
  it("books unique proposals by default and follows the stored decision", () => {
    expect(effectiveDecision("unique", null)).toBe("book");
    expect(effectiveDecision("unique", "discard")).toBe("discard");
    expect(effectiveDecision("unique", "book")).toBe("book");
  });

  it("never books a duplicate", () => {
    expect(effectiveDecision("duplicate", null)).toBe("discard");
    expect(effectiveDecision("duplicate", "book")).toBe("discard");
  });

  it("leaves an ambiguous proposal open until decided", () => {
    expect(effectiveDecision("ambiguous", null)).toBe("open");
    expect(effectiveDecision("ambiguous", "book")).toBe("book");
    expect(effectiveDecision("ambiguous", "discard")).toBe("discard");
  });
});

describe("itemReviewStatus", () => {
  it("derives the chip of a file", () => {
    expect(itemReviewStatus("FAILED", [])).toBe("FAILED");
    expect(itemReviewStatus("PARSED", [])).toBe("FAILED");
    expect(itemReviewStatus("PARSED", ["unique", "ambiguous", "duplicate"])).toBe("AMBIGUOUS");
    expect(itemReviewStatus("PARSED", ["duplicate", "duplicate"])).toBe("DUPLICATE");
    expect(itemReviewStatus("PARSED", ["duplicate", "unique"])).toBe("PARSED");
    expect(itemReviewStatus("PARSED", ["unique"])).toBe("PARSED");
    expect(itemReviewStatus("NO_BOOKING", [])).toBe("NO_BOOKING");
  });
});

describe("reviewCounts", () => {
  it("counts files per chip, open decisions and the keys to book", () => {
    const counts = reviewCounts([
      { reviewStatus: "PARSED", proposals: [{ key: "a:0", effective: "book" }, { key: "a:1", effective: "discard" }] },
      { reviewStatus: "AMBIGUOUS", proposals: [{ key: "b:0", effective: "open" }] },
      { reviewStatus: "DUPLICATE", proposals: [{ key: "c:0", effective: "discard" }] },
      { reviewStatus: "FAILED", proposals: [] },
      { reviewStatus: "PARSED", proposals: [{ key: "e:0", effective: "book" }] },
      { reviewStatus: "NO_BOOKING", proposals: [] },
    ]);
    expect(counts).toEqual({
      fileCount: 6,
      files: { PARSED: 2, AMBIGUOUS: 1, DUPLICATE: 1, NO_BOOKING: 1, FAILED: 1 },
      openDecisions: 1,
      bookKeys: ["a:0", "e:0"],
    });
  });
});

describe("readDecisions / proposalKey", () => {
  it("aligns stored decisions to the proposals and drops unreadable values", () => {
    expect(readDecisions('["book", null, "discard", "x"]', 4)).toEqual(["book", null, "discard", null]);
    expect(readDecisions("[]", 2)).toEqual([null, null]);
    expect(readDecisions("nope", 1)).toEqual([null]);
    expect(readDecisions('{"a":1}', 1)).toEqual([null]);
    expect(proposalKey("i1", 2)).toBe("i1:2");
  });
});
