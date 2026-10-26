import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { type FetchCall, fakeFetch, recorded, recordedText } from "../../../test/helpers/providers";
import { createDepot, ensureSecurity, recordTrade } from "@/modules/ledger";
import { setMapping } from "@/modules/prices";
import { listNews, NEWS_PER_SECURITY_LIMIT, newsNeedsRefresh, refreshNews } from "./index";
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

/** Fake fetch answering per edition (`hl=de` / `hl=en-US`). */
function googleFetch(de: () => Response | Error, en: () => Response | Error) {
  return fakeFetch((call: FetchCall) => (new URL(call.url).searchParams.get("hl") === "de" ? de() : en()));
}

const yahoo = (value: unknown = recorded("yahoo-search-news-sap")) => vi.fn<YahooNewsSearch>(async () => value);
const yahooFailing = () => vi.fn<YahooNewsSearch>(async () => Promise.reject(new Error("HTTP 429")));

async function held(isin: string, name: string, quantity = "10"): Promise<string> {
  const security = await ensureSecurity({ isin }, { name, assetType: "STOCK" }, db());
  if (!security.ok) throw new Error("setup failed");
  const trade = await recordTrade(
    { depotId, type: "BUY", date: "2026-10-01", quantity, price: "100", security: { id: security.security.id } },
    db(),
  );
  if (!trade.ok) throw new Error("setup failed");
  return security.security.id;
}

const run = (fetch: FetchLike, search: YahooNewsSearch, options: { onlyStale?: boolean; now?: Date } = {}) =>
  refreshNews({ now: NOW, ...options, deps: { fetch, search } }, db());

const articles = (securityId: string) =>
  db().newsArticle.findMany({ where: { securityId }, orderBy: { publishedAt: "desc" } });

describe("refreshNews", () => {
  it("merges Google de, Google en and Yahoo: deduped, window applied, newest first, fetch recorded", async () => {
    const sap = await held("DE0007164600", "SAP SE");
    await setMapping(sap, { provider: "YAHOO", symbol: "SAP.DE" }, db());
    const { fetch, calls } = googleFetch(SAP_DE, SAP_EN);
    const search = yahoo();

    expect(await run(fetch, search)).toEqual({ updated: 1, failed: [] });

    // Query privacy: only the name term; the ISIN appears in no request.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
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
    expect(rows.every((row) => row.fetchedAt === NOW.toISOString())).toBe(true);
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
    });
  });

  it("filters by a held Security; an unknown or non-held id lists all", async () => {
    const { sap, idle } = await seed();
    expect((await listNews(TODAY, sap, db())).articles.map((article) => article.title)).toEqual(["A SAP gleichzeitig", "B SAP neu"]);
    expect((await listNews(TODAY, idle, db())).articles).toHaveLength(4);
    expect((await listNews(TODAY, "unknown", db())).articles).toHaveLength(4);
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
