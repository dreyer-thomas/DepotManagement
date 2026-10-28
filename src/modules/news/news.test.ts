import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { type FetchCall, fakeFetch, recorded, recordedText } from "../../../test/helpers/providers";
import { createDepot, ensureSecurity, recordTrade } from "@/modules/ledger";
import { setMapping } from "@/modules/prices";
import { clearNews, listNews, listSecurityNews, NEWS_PER_SECURITY_LIMIT, newsNeedsRefresh, refreshNews, YAHOO_RSS_SPACING_MS } from "./index";
import type { FetchLike } from "./providers/shared";
import type { YahooNewsSearch } from "./providers/yahoo";

let testDb: TestDatabase;
let depotId: string;
let warn: MockInstance<typeof console.warn>;

beforeEach(async () => {
  testDb = createTestDatabase();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
});

const db = () => testDb.client;
const NOW = new Date("2026-10-26T10:00:00.000Z");
const TODAY = "2026-10-26";

const rss = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/xml" } });
const SAP_DE = () => rss(recordedText("google-news-rss-sap-de.xml"));
const SAP_EN = () => rss(recordedText("google-news-rss-sap-en.xml"));
const EMPTY = () => rss(recordedText("google-news-rss-empty.xml"));

const YAHOO_RSS = () => rss(recordedText("yahoo-rss-sap.xml"));
const isRss = (call: FetchCall) => new URL(call.url).hostname === "feeds.finance.yahoo.com";

/**
 * Fake fetch answering Google News per edition (`hl=de` / `hl=en-US`) and the Yahoo RSS feed separately
 * (by default a network error, so a Yahoo-mapped Security keeps its Google/Yahoo-search headlines).
 */
function googleFetch(de: () => Response | Error, en: () => Response | Error, yahooRss: () => Response | Error = () => new TypeError("offline")) {
  const fake = fakeFetch((call: FetchCall) => {
    if (isRss(call)) return yahooRss();
    return new URL(call.url).searchParams.get("hl") === "de" ? de() : en();
  });
  return { ...fake, googleCalls: () => fake.calls.filter((call) => !isRss(call)), rssCalls: () => fake.calls.filter(isRss) };
}

const yahoo = (value: unknown = recorded("yahoo-search-news-sap")) => vi.fn<YahooNewsSearch>(async () => value);
const yahooFailing = () => vi.fn<YahooNewsSearch>(async () => Promise.reject(new Error("HTTP 429")));

async function held(
  isin: string,
  name: string,
  quantity = "10",
  assetType = "STOCK",
  identifier: { isin: string } | { cryptoSymbol: string } = { isin },
): Promise<string> {
  const security = await ensureSecurity(identifier, { name, assetType }, db());
  if (!security.ok) throw new Error("setup failed");
  const trade = await recordTrade(
    { depotId, type: "BUY", date: "2026-10-01", quantity, price: "100", security: { id: security.security.id } },
    db(),
  );
  if (!trade.ok) throw new Error("setup failed");
  return security.security.id;
}

/** No-op spacing (the spacing test injects its own). */
const sleep = async () => {};

const run = (
  fetch: FetchLike,
  search: YahooNewsSearch,
  options: { onlyStale?: boolean; now?: Date; watched?: (db: unknown) => Promise<readonly string[]> } = {},
) =>
  refreshNews({ now: NOW, ...options, deps: { fetch, search, sleep } }, db());

const articles = (securityId: string) =>
  db().newsArticle.findMany({ where: { securityId }, orderBy: { publishedAt: "desc" } });

describe("refreshNews", () => {
  it("merges Google de, Google en and Yahoo: deduped, window applied, newest first, fetch recorded", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const { fetch, googleCalls } = googleFetch(SAP_DE, SAP_EN);
    const search = yahoo();

    expect(await run(fetch, search)).toEqual({ updated: 1, failed: [] });

    // Query privacy: only the name term; the ISIN appears in no request.
    expect(googleCalls()).toHaveLength(2);
    for (const call of googleCalls()) {
      expect(new URL(call.url).searchParams.get("q")).toBe('"SAP" when:14d');
      expect(call.url).not.toContain("DE0007164600");
    }
    expect(search).toHaveBeenCalledWith("SAP.DE");
    const rows = await articles(sap);
    expect(rows.map((row) => [row.title, row.provider, row.publishedAt])).toEqual([
      ["SAP hebt Prognose an", "GOOGLE_NEWS", "2026-10-26T07:30:00.000Z"],
      ["SAP shares rise after earnings", "GOOGLE_NEWS", "2026-10-25T18:00:00.000Z"],
      ["SAP & Partner: Cloud-Umsatz wächst – Analyse", "GOOGLE_NEWS", "2026-10-24T12:00:00.000Z"],
      // Same URL in de and en: stored once, the de headline wins.
      ["SAP startet KI-Offensive", "GOOGLE_NEWS", "2026-10-23T15:00:00.000Z"],
      ["SAP Q3 results beat estimates", "YAHOO", "2026-10-22T10:00:00.000Z"],
      ["SAP partners with example startup", "YAHOO", "2026-10-20T08:15:00.000Z"],
      // 13 days old: kept; the 20-day-old item is dropped.
      ["SAP-Aktie: Was <Anleger> jetzt wissen müssen", "GOOGLE_NEWS", "2026-10-13T09:00:00.000Z"],
    ]);
    expect(rows.every((row) => row.fetchedAt === NOW.toISOString() && row.teaser === null)).toBe(true);
    expect(await db().newsFetch.findUnique({ where: { securityId: sap } })).toEqual({ securityId: sap, fetchedAt: NOW.toISOString() });
  });

  it("queries Yahoo by the name term when the Security is not mapped to Yahoo", async () => {
    await held("DE0007164600", "SAP SE");
    const search = yahoo();
    await run(googleFetch(EMPTY, EMPTY).fetch, search);
    expect(search).toHaveBeenCalledWith("SAP");
  });

  it("replaces the cache with the successful providers on a partial failure", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await run(googleFetch(SAP_DE, SAP_EN).fetch, yahoo());
    const later = new Date("2026-10-26T16:00:00.000Z");

    const result = await run(googleFetch(() => rss("unavailable", 503), () => rss("unavailable", 503)).fetch, yahoo(), { now: later });

    expect(result).toEqual({ updated: 1, failed: [] });
    expect((await articles(sap)).map((row) => row.provider)).toEqual(["YAHOO", "YAHOO", "YAHOO"]);
    expect((await db().newsFetch.findUnique({ where: { securityId: sap } }))?.fetchedAt).toBe(later.toISOString());
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("HTTP 503");
  });

  it("leaves the cache and fetch time untouched when every provider fails", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await run(googleFetch(SAP_DE, SAP_EN).fetch, yahoo());
    const before = await articles(sap);

    const result = await run(googleFetch(() => new TypeError("fetch failed"), () => rss("<html></html>")).fetch, yahooFailing(), {
      now: new Date("2026-10-26T16:00:00.000Z"),
    });

    expect(result).toEqual({ updated: 0, failed: [{ securityId: sap, name: "SAP SE" }] });
    expect(await articles(sap)).toEqual(before);
    expect((await db().newsFetch.findUnique({ where: { securityId: sap } }))?.fetchedAt).toBe(NOW.toISOString());
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toMatch(/https?:\/\/|"SAP"/);
  });

  it("records an empty but successful refresh", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    expect(await run(googleFetch(EMPTY, EMPTY).fetch, yahoo({ news: [] }))).toEqual({ updated: 1, failed: [] });
    expect(await articles(sap)).toEqual([]);
    expect(await db().newsFetch.findUnique({ where: { securityId: sap } })).not.toBeNull();
  });

  it("keeps only the newest articles per Security", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    const news = Array.from({ length: 40 }, (_, index) => ({
      title: `Meldung ${index}`,
      publisher: "Example",
      link: `https://a.example.com/${index}`,
      providerPublishTime: Date.parse("2026-10-20T00:00:00Z") / 1000 + index * 3600,
    }));
    await run(googleFetch(EMPTY, EMPTY).fetch, yahoo({ news }));
    const rows = await articles(sap);
    expect(rows).toHaveLength(NEWS_PER_SECURITY_LIMIT);
    expect(rows[0].title).toBe("Meldung 39");
    expect(rows.at(-1)?.title).toBe("Meldung 10");
  });

  it("does not query sold-out or archived Securities and deletes their cached rows", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    const sold = await held("US0378331005", "Apple Inc.");
    await run(googleFetch(SAP_DE, SAP_EN).fetch, yahoo());
    expect(await db().newsArticle.count({ where: { securityId: sold } })).toBeGreaterThan(0);
    const sell = await recordTrade(
      { depotId, type: "SELL", date: "2026-10-20", quantity: "10", price: "1", security: { id: sold } },
      db(),
    );
    if (!sell.ok) throw new Error("setup failed");

    const { fetch, calls } = googleFetch(SAP_DE, SAP_EN);
    await run(fetch, yahoo());
    expect(calls).toHaveLength(2);
    expect(await db().newsArticle.count({ where: { securityId: sold } })).toBe(0);
    expect(await db().newsFetch.findUnique({ where: { securityId: sold } })).toBeNull();

    // Archiving requires a flat Depot; flag it directly to cover the archived case of the held set.
    await db().depot.update({ where: { id: depotId }, data: { archived: true } });
    const archived = googleFetch(SAP_DE, SAP_EN);
    expect(await run(archived.fetch, yahoo())).toEqual({ updated: 0, failed: [] });
    expect(archived.calls).toHaveLength(0);
    expect(await db().newsArticle.count({ where: { securityId: sap } })).toBe(0);
  });

  it("adds watched Securities to the news set: fetched, cache kept, onlyStale applies, never listed as held", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    const idea = await ensureSecurity({ isin: "DE0007236101" }, { name: "Siemens AG", assetType: "STOCK" }, db());
    if (!idea.ok) throw new Error("setup failed");
    const watchedId = idea.security.id;
    const watched = vi.fn(async () => [watchedId, sap]);

    const first = googleFetch(SAP_DE, SAP_EN);
    expect(await run(first.fetch, yahoo(), { watched })).toEqual({ updated: 2, failed: [] });
    expect(watched).toHaveBeenCalledWith(db());
    expect(first.calls.map((call) => new URL(call.url).searchParams.get("q"))).toContain('"Siemens" when:14d');
    expect(await db().newsFetch.findUnique({ where: { securityId: watchedId } })).not.toBeNull();
    const cached = await db().newsArticle.count({ where: { securityId: watchedId } });
    expect(cached).toBeGreaterThan(0);

    // Fresh caches: onlyStale queries nothing and keeps the watched cache.
    const stale = googleFetch(SAP_DE, SAP_EN);
    expect(await run(stale.fetch, yahoo(), { watched, onlyStale: true })).toEqual({ updated: 0, failed: [] });
    expect(stale.calls).toHaveLength(0);
    expect(await db().newsArticle.count({ where: { securityId: watchedId } })).toBe(cached);

    // The news page stays held-only; the detail page lists the watched Security's own articles.
    expect((await listNews(TODAY, undefined, db())).securities.map((security) => security.id)).toEqual([sap]);
    expect((await listNews(TODAY, undefined, db())).articles.every((article) => article.securityId === sap)).toBe(true);
    expect(await listSecurityNews(TODAY, watchedId, db())).toHaveLength(cached);

    // Without the loader the watched Security leaves the set and its cache is deleted.
    await run(googleFetch(SAP_DE, SAP_EN).fetch, yahoo());
    expect(await db().newsArticle.count({ where: { securityId: watchedId } })).toBe(0);
    expect(await db().newsFetch.findUnique({ where: { securityId: watchedId } })).toBeNull();
  });

  it("with onlyStale queries only Securities without a refresh in the last 4 hours", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    const siemens = await held("DE0007236101", "Siemens AG");
    await db().newsFetch.createMany({
      data: [
        { securityId: sap, fetchedAt: "2026-10-26T09:00:00.000Z" },
        { securityId: siemens, fetchedAt: "2026-10-26T05:00:00.000Z" },
      ],
    });
    const { fetch, calls } = googleFetch(EMPTY, EMPTY);
    const search = yahoo({ news: [] });
    expect(await run(fetch, search, { onlyStale: true })).toEqual({ updated: 1, failed: [] });
    expect(calls.map((call) => new URL(call.url).searchParams.get("q"))).toEqual(['"Siemens" when:14d', '"Siemens" when:14d']);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("adds Yahoo RSS items with teasers: only the symbol is sent, unrelated and old items dropped, teaser wins duplicates", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const { fetch, rssCalls } = googleFetch(SAP_DE, SAP_EN, YAHOO_RSS);

    expect(await run(fetch, yahoo({ news: [] }))).toEqual({ updated: 1, failed: [] });

    expect(rssCalls().map((call) => call.url)).toEqual([
      "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SAP.DE&region=DE&lang=de-DE",
    ]);
    const rows = await articles(sap);
    expect(rows.map((row) => [row.title, row.provider, row.url])).toEqual([
      ["SAP-Aktie legt nach Zahlen zu", "YAHOO_RSS", "https://finance.example.com/sap-zahlen"],
      // Same normalized title as the Google de item: one row, the RSS item with its teaser replaces it.
      ["SAP hebt Prognose an", "YAHOO_RSS", "https://finance.example.com/sap-prognose"],
      ["SAP shares rise after earnings", "GOOGLE_NEWS", "https://wire.example.org/sap-earnings"],
      // Kept: the teaser mentions SAP.
      ["Walldorfer Konzern im Fokus", "YAHOO_RSS", "https://finance.example.com/walldorf-fokus"],
      ["SAP & Partner: Cloud-Umsatz wächst – Analyse", "GOOGLE_NEWS", "https://news.example.com/sap-cloud?id=1&ref=rss"],
      ["SAP ohne Kurztext", "YAHOO_RSS", "https://finance.example.com/sap-ohne-kurztext"],
      ["SAP startet KI-Offensive", "GOOGLE_NEWS", "https://news.example.com/sap-shared"],
      ["SAP-Aktie: Was <Anleger> jetzt wissen müssen", "GOOGLE_NEWS", "https://boerse.example.com/sap-anleger"],
    ]);
    const teasers = new Map(rows.map((row) => [row.title, row.teaser]));
    expect(teasers.get("SAP-Aktie legt nach Zahlen zu")).toBe("SAP & Co");
    expect(teasers.get("Walldorfer Konzern im Fokus")).toHaveLength(480);
    expect(teasers.get("SAP ohne Kurztext")).toBeNull();
    expect(teasers.get("SAP shares rise after earnings")).toBeNull();

    const listed = await listNews(TODAY, sap, db());
    expect(listed.articles[0]).toMatchObject({ title: "SAP-Aktie legt nach Zahlen zu", teaser: "SAP & Co" });
    expect(listed.articles.find((article) => article.title === "SAP startet KI-Offensive")?.teaser).toBeNull();
  });

  it("replaces an earlier headline-only duplicate found by URL with the RSS item and its teaser", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    // Yahoo search delivers the RSS headline's URL without a teaser: the RSS item (later) replaces it.
    const search = yahoo({
      news: [
        { title: "Anderer Titel", publisher: "Example", link: "https://finance.example.com/sap-zahlen", providerPublishTime: "2026-10-26T08:00:00Z" },
      ],
    });
    await run(googleFetch(EMPTY, EMPTY, YAHOO_RSS).fetch, search);
    const rows = await articles(sap);
    expect(rows.filter((row) => row.url === "https://finance.example.com/sap-zahlen").map((row) => [row.title, row.provider])).toEqual([
      ["SAP-Aktie legt nach Zahlen zu", "YAHOO_RSS"],
    ]);
  });

  it("does not query Yahoo RSS for an ETF and derives the crypto symbol from the crypto symbol", async () => {
    const etf = await held("IE00B4L5Y983", "iShares Core MSCI World UCITS ETF", "10", "ETF");
    await setMapping(etf, { provider: "YAHOO", symbol: "EUNL.DE" }, db());
    const btc = await held("", "Bitcoin", "1", "CRYPTO", { cryptoSymbol: "BTC" });
    await setMapping(btc, { provider: "COINGECKO", symbol: "bitcoin" }, db());
    const { fetch, rssCalls } = googleFetch(EMPTY, EMPTY, EMPTY);

    await run(fetch, yahoo({ news: [] }));

    expect(rssCalls().map((call) => new URL(call.url).searchParams.get("s"))).toEqual(["BTC-EUR"]);
  });

  it("keeps the Google headlines when Yahoo RSS fails or answers an empty or non-feed body", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    for (const reply of [() => rss("unavailable", 503), () => rss("<html></html>"), () => rss(recordedText("yahoo-rss-empty.xml"))]) {
      warn.mockClear();
      expect(await run(googleFetch(SAP_DE, EMPTY, reply).fetch, yahooFailing())).toEqual({ updated: 1, failed: [] });
      const rows = await articles(sap);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.provider === "GOOGLE_NEWS")).toBe(true);
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("Yahoo RSS");
      expect(logged).not.toMatch(/https?:\/\/|SAP\.DE/);
    }
  });

  it("marks the Security failed only when every queried provider including Yahoo RSS fails", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const failing = () => rss("unavailable", 503);
    expect(await run(googleFetch(failing, failing, YAHOO_RSS).fetch, yahooFailing())).toEqual({ updated: 1, failed: [] });
    expect((await articles(sap)).every((row) => row.provider === "YAHOO_RSS")).toBe(true);
    expect(await run(googleFetch(failing, failing, failing).fetch, yahooFailing())).toEqual({
      updated: 0,
      failed: [{ securityId: sap, name: "SAP SE" }],
    });
  });

  it("spaces consecutive Yahoo RSS requests of a run", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    const siemens = await held("DE0007236101", "Siemens AG");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    await setMapping(siemens, { provider: "YAHOO", symbol: "SIE.DE" }, db());
    const { fetch, rssCalls } = googleFetch(EMPTY, EMPTY, YAHOO_RSS);
    const delays: number[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deferredSleep = async (ms: number) => {
      delays.push(ms);
      await gate;
    };

    const running = refreshNews({ now: NOW, deps: { fetch, search: yahoo({ news: [] }), sleep: deferredSleep } }, db());
    await vi.waitFor(() => expect(delays).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The second RSS request waits for the spacing.
    expect(rssCalls()).toHaveLength(1);
    release();
    await running;

    expect(rssCalls()).toHaveLength(2);
    expect(delays[0]).toBeGreaterThan(0);
    expect(delays[0]).toBeLessThanOrEqual(YAHOO_RSS_SPACING_MS);
    expect(YAHOO_RSS_SPACING_MS).toBeGreaterThanOrEqual(1000);
  });

  it("marks the Security failed when the RSS feed has no item mentioning it and every other provider fails", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const unrelated = () =>
      rss(`<rss><channel><item><title>Märkte schließen uneinheitlich</title><link>https://finance.example.com/maerkte</link>
        <description>Die Börsen beenden den Tag ohne klare Richtung.</description><pubDate>Mon, 26 Oct 2026 08:00:00 +0000</pubDate></item></channel></rss>`);
    const failing = () => rss("unavailable", 503);
    expect(await run(googleFetch(failing, failing, unrelated).fetch, yahooFailing())).toEqual({
      updated: 0,
      failed: [{ securityId: sap, name: "SAP SE" }],
    });
    expect(await db().newsFetch.findUnique({ where: { securityId: sap } })).toBeNull();
  });

  it("keeps the first of two duplicates that both have a teaser", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const item = (url: string, title: string, teaser: string) =>
      `<item><title>${title}</title><link>${url}</link><description>${teaser}</description><pubDate>Mon, 26 Oct 2026 08:00:00 +0000</pubDate></item>`;
    const body = () =>
      rss(
        `<rss><channel>${item("https://finance.example.com/erste", "SAP meldet Zahlen", "Erster Kurztext zu SAP.")}${item(
          "https://finance.example.com/zweite",
          "sap  MELDET zahlen",
          "Zweiter Kurztext zu SAP.",
        )}</channel></rss>`,
      );
    await run(googleFetch(EMPTY, EMPTY, body).fetch, yahoo({ news: [] }));
    expect((await articles(sap)).map((row) => [row.url, row.teaser])).toEqual([["https://finance.example.com/erste", "Erster Kurztext zu SAP."]]);
  });

  it("purges teasers with their headlines on clearNews", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    await run(googleFetch(EMPTY, EMPTY, YAHOO_RSS).fetch, yahoo({ news: [] }));
    expect(await db().newsArticle.count({ where: { teaser: { not: null } } })).toBeGreaterThan(0);
    await clearNews(db());
    expect(await db().newsArticle.count()).toBe(0);
  });

  it("serializes concurrent runs", async () => {
    await held("DE0007164600", "SAP SE");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const events: string[] = [];
    const search = vi.fn<YahooNewsSearch>(async () => {
      events.push("search");
      await gate;
      return { news: [] };
    });
    const { fetch, calls } = googleFetch(EMPTY, EMPTY);
    const first = run(fetch, search);
    const second = run(fetch, search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(4);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe("listNews / newsNeedsRefresh", () => {
  async function seed() {
    const sap = await held("DE0007164600", "SAP SE");
    const siemens = await held("DE0007236101", "Siemens AG");
    const idle = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, db());
    if (!idle.ok) throw new Error("setup failed");
    const article = (securityId: string, title: string, publishedAt: string) => ({
      securityId,
      title,
      url: `https://a.example.com/${encodeURIComponent(title)}`,
      source: "Example",
      publishedAt,
      provider: "GOOGLE_NEWS" as const,
      fetchedAt: NOW.toISOString(),
    });
    await db().newsArticle.createMany({
      data: [
        article(sap, "B SAP neu", "2026-10-25T10:00:00.000Z"),
        article(sap, "A SAP gleichzeitig", "2026-10-25T10:00:00.000Z"),
        article(siemens, "Siemens heute", "2026-10-26T06:00:00.000Z"),
        // Berlin date 2026-10-13 (window start) and 2026-10-12 (outside).
        article(siemens, "Siemens Fensterbeginn", "2026-10-12T22:30:00.000Z"),
        article(siemens, "Siemens zu alt", "2026-10-12T21:30:00.000Z"),
        article(idle.security.id, "Apple nicht gehalten", "2026-10-26T06:00:00.000Z"),
      ],
    });
    return { sap, siemens, idle: idle.security.id };
  }

  it("lists held Securities and their window articles newest first (tie: title)", async () => {
    const { sap, siemens } = await seed();
    const listing = await listNews(TODAY, undefined, db());
    expect(listing.securities).toEqual([
      { id: sap, name: "SAP SE" },
      { id: siemens, name: "Siemens AG" },
    ]);
    expect(listing.articles.map((article) => [article.title, article.name])).toEqual([
      ["Siemens heute", "Siemens AG"],
      ["A SAP gleichzeitig", "SAP SE"],
      ["B SAP neu", "SAP SE"],
      ["Siemens Fensterbeginn", "Siemens AG"],
    ]);
    expect(listing.articles[0]).toEqual({
      id: expect.any(String),
      securityId: siemens,
      name: "Siemens AG",
      title: "Siemens heute",
      url: "https://a.example.com/Siemens%20heute",
      source: "Example",
      publishedAt: "2026-10-26T06:00:00.000Z",
      teaser: null,
    });
  });

  it("filters by a held Security; an unknown or non-held id lists all", async () => {
    const { sap, idle } = await seed();
    expect((await listNews(TODAY, sap, db())).articles.map((article) => article.title)).toEqual(["A SAP gleichzeitig", "B SAP neu"]);
    expect((await listNews(TODAY, idle, db())).articles).toHaveLength(4);
    expect((await listNews(TODAY, "unknown", db())).articles).toHaveLength(4);
  });

  it("listSecurityNews lists one Security's window articles, held or not; unknown id is empty", async () => {
    const { sap, idle } = await seed();
    expect((await listSecurityNews(TODAY, sap, db())).map((article) => article.title)).toEqual(["A SAP gleichzeitig", "B SAP neu"]);
    expect(await listSecurityNews(TODAY, idle, db())).toEqual([
      {
        id: expect.any(String),
        securityId: idle,
        name: "Apple Inc.",
        title: "Apple nicht gehalten",
        url: "https://a.example.com/Apple%20nicht%20gehalten",
        source: "Example",
        publishedAt: "2026-10-26T06:00:00.000Z",
        teaser: null,
      },
    ]);
    expect(await listSecurityNews(TODAY, "unknown", db())).toEqual([]);
  });

  it("returns nothing when nothing is held", async () => {
    expect(await listNews(TODAY, undefined, db())).toEqual({ securities: [], articles: [] });
    expect(await newsNeedsRefresh(NOW, db())).toBe(false);
  });

  it("needs a refresh when any held Security has no fetch or one older than 4 hours", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    expect(await newsNeedsRefresh(NOW, db())).toBe(true);
    await db().newsFetch.create({ data: { securityId: sap, fetchedAt: "2026-10-26T06:30:00.000Z" } });
    expect(await newsNeedsRefresh(NOW, db())).toBe(false);
    expect(await newsNeedsRefresh(new Date("2026-10-26T10:31:00.000Z"), db())).toBe(true);
  });
});
