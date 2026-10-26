import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorded } from "../../../../test/helpers/providers";
import { searchYahooNews } from "./yahoo";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("searchYahooNews", () => {
  it("validates the recorded news, converts epoch seconds and ISO times, drops invalid items", async () => {
    const search = vi.fn(async () => recorded("yahoo-search-news-sap"));
    const result = await searchYahooNews("SAP.DE", search);
    expect(search).toHaveBeenCalledWith("SAP.DE");
    expect(result).toEqual({
      ok: true,
      articles: [
        {
          url: "https://finance.example.net/sap-prognose",
          title: "SAP hebt Prognose an",
          source: "Example Finance",
          publishedAt: "2026-10-26T06:00:00.000Z",
        },
        {
          url: "https://finance.example.net/sap-q3",
          title: "SAP Q3 results beat estimates",
          source: "Example Finance",
          publishedAt: "2026-10-22T10:00:00.000Z",
        },
        {
          url: "https://daily.example.net/sap-startup",
          title: "SAP partners with example startup",
          source: "Example Daily",
          publishedAt: "2026-10-20T08:15:00.000Z",
        },
      ],
    });
  });

  it("accepts Date objects and epoch milliseconds", async () => {
    const result = await searchYahooNews("SAP", async () => ({
      news: [
        { title: "A", publisher: "P", link: "https://a.example.com/a", providerPublishTime: new Date("2026-10-25T10:00:00Z") },
        { title: "B", publisher: "P", link: "https://a.example.com/b", providerPublishTime: 1792663200000 },
        { title: "C", publisher: "P", link: "ftp://a.example.com/c", providerPublishTime: 1792663200 },
        { title: "D", publisher: "P", link: "https://a.example.com/d", providerPublishTime: "not a date" },
      ],
    }));
    expect(result.ok && result.articles.map((article) => [article.title, article.publishedAt])).toEqual([
      ["A", "2026-10-25T10:00:00.000Z"],
      ["B", "2026-10-22T10:00:00.000Z"],
    ]);
  });

  it("maps a thrown search and a response without news to a provider error", async () => {
    expect(await searchYahooNews("SAP", async () => Promise.reject(new Error("HTTP 429")))).toEqual({ ok: false });
    expect(await searchYahooNews("SAP", async () => ({ quotes: [] }))).toEqual({ ok: false });
    expect(await searchYahooNews("SAP", async () => ({ news: [] }))).toEqual({ ok: true, articles: [] });
  });
});
