import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real `yahooNewsSearch` with `yahoo-finance2` replaced: checks the options sent to the library.
const yahooSearch = vi.hoisted(() => vi.fn());
vi.mock("yahoo-finance2", () => ({ default: class { search = yahooSearch } }));

import { searchYahooNews } from "./yahoo";

beforeEach(() => {
  yahooSearch.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("yahooNewsSearch (default client)", () => {
  it("asks yahoo-finance2 for news only, unvalidated, with a timeout signal", async () => {
    yahooSearch.mockResolvedValue({
      news: [{ title: "A", publisher: "P", link: "https://a.example.com/a", providerPublishTime: 1792663200 }],
    });
    const result = await searchYahooNews("SAP.DE");
    expect(yahooSearch).toHaveBeenCalledWith(
      "SAP.DE",
      { quotesCount: 0, newsCount: 10 },
      { validateResult: false, fetchOptions: { signal: expect.any(AbortSignal) } },
    );
    expect(result).toEqual({
      ok: true,
      articles: [{ url: "https://a.example.com/a", title: "A", source: "P", publishedAt: "2026-10-22T10:00:00.000Z" }],
    });
  });
});
