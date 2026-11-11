import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/_actions/news", () => ({ refreshNewsAction: vi.fn() }));

import { prisma } from "@/db";
import { createDepot, ensureSecurity, recordTrade } from "@/modules/ledger";
import { addWatchlistEntry, createWatchlist } from "@/modules/watchlist";
import { NewsAutoRefresh } from "../../_components/news/NewsAutoRefresh";
import { NewsFilter } from "../../_components/news/NewsFilter";
import { NewsList } from "../../_components/news/NewsList";
import NewsPage from "./page";

const render = (security?: string, scope?: string) =>
  NewsPage({ searchParams: Promise.resolve({ ...(security ? { security } : {}), ...(scope ? { scope } : {}) }) });

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-26T10:00:00.000Z"), toFake: ["Date"] });
  await prisma.newsArticle.deleteMany();
  await prisma.newsFetch.deleteMany();
  await prisma.price.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.depot.deleteMany();
  await prisma.security.deleteMany();
  await prisma.watchlist.deleteMany();
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await prisma.$disconnect();
  dbFile.removeFiles();
});

async function held(isin: string, name: string, depotId: string) {
  const security = await ensureSecurity({ isin }, { name, assetType: "STOCK" });
  if (!security.ok) throw new Error("setup failed");
  const trade = await recordTrade({ depotId, type: "BUY", date: "2026-10-01", quantity: "1", price: "100", security: { id: security.security.id } });
  if (!trade.ok) throw new Error("setup failed");
  return security.security.id;
}

async function seed() {
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  if (!depot.ok) throw new Error("setup failed");
  const sap = await held("DE0007164600", "SAP SE", depot.depot.id);
  const siemens = await held("DE0007236101", "Siemens AG", depot.depot.id);
  const article = (securityId: string, title: string, publishedAt: string, url: string) => ({
    securityId,
    title,
    url,
    source: "Beispiel Zeitung",
    publishedAt,
    provider: "GOOGLE_NEWS" as const,
    fetchedAt: "2026-10-26T09:00:00.000Z",
  });
  await prisma.newsArticle.createMany({
    data: [
      article(sap, "SAP hebt Prognose an", "2026-10-25T08:00:00.000Z", "https://news.example.com/sap"),
      article(siemens, "Siemens baut Werk aus", "2026-10-26T06:00:00.000Z", "https://news.example.com/siemens"),
      article(siemens, "Siemens vor drei Wochen", "2026-10-05T06:00:00.000Z", "https://news.example.com/alt"),
    ],
  });
  return { sap, siemens };
}

describe("News page", () => {
  it("shows the title and the empty state without a filter or refresh when nothing is held", async () => {
    const tree = await render();
    const text = renderText(tree);
    expect(text).toContain("Nachrichten");
    expect(text).toContain("Keine Nachrichten der letzten 14 Tage.");
    expect(findElement(tree, NewsFilter)).toBeUndefined();
    expect(findElement(tree, NewsAutoRefresh)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists cached headlines newest first with external links and renders no refresh when fresh", async () => {
    const { sap, siemens } = await seed();
    await prisma.newsFetch.createMany({
      data: [
        { securityId: sap, fetchedAt: "2026-10-26T09:00:00.000Z" },
        { securityId: siemens, fetchedAt: "2026-10-26T09:00:00.000Z" },
      ],
    });

    const tree = await render();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findElement(tree, NewsAutoRefresh)).toBeUndefined();
    expect(findElement(tree, NewsFilter)?.props).toEqual({
      securities: [
        { id: sap, name: "SAP SE" },
        { id: siemens, name: "Siemens AG" },
      ],
      selected: undefined,
      scope: "all",
    });
    expect((findElement(tree, NewsList)?.props.articles as { title: string }[]).map((a) => a.title)).toEqual([
      "Siemens baut Werk aus",
      "SAP hebt Prognose an",
    ]);
    const text = renderText(tree);
    // Held Securities carry the "im Depot" chip; with only the BUY price there is no change today.
    expect(text).toContain("Siemens AG im Depot Siemens baut Werk aus Beispiel Zeitung · 26.10.2026");
    expect(text).toContain("SAP SE im Depot SAP hebt Prognose an Beispiel Zeitung · 25.10.2026");
    expect(text).not.toContain("drei Wochen");
    const html = renderHtml(tree);
    expect(html).toContain('href="https://news.example.com/siemens" target="_blank" rel="noopener noreferrer"');
  });

  it("renders a cached teaser item as a collapsed accordion with the Kurztext marker", async () => {
    const { sap } = await seed();
    await prisma.newsArticle.create({
      data: {
        securityId: sap,
        title: "SAP-Aktie legt nach Zahlen zu",
        url: "https://finance.example.com/sap-zahlen",
        source: "Muster Finanz",
        publishedAt: "2026-10-26T08:00:00.000Z",
        provider: "YAHOO_RSS",
        teaser: "SAP & Co melden erfundene Zahlen.",
        fetchedAt: "2026-10-26T09:00:00.000Z",
      },
    });

    const tree = await render();

    const listed = findElement(tree, NewsList)?.props.articles as { title: string; teaser: string | null }[];
    expect(listed.map((a) => [a.title, a.teaser])).toEqual([
      ["SAP-Aktie legt nach Zahlen zu", "SAP & Co melden erfundene Zahlen."],
      ["Siemens baut Werk aus", null],
      ["SAP hebt Prognose an", null],
    ]);
    const html = renderHtml(tree);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    expect(html).toContain("Kurztext");
    expect(html).toMatch(/role="region"[^>]*hidden=""/);
    expect(html).toContain("SAP &amp; Co melden erfundene Zahlen.");
    expect(html).toContain('href="https://finance.example.com/sap-zahlen" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Zum Artikel");
    // Headline-only items stay direct links.
    expect(html).toContain('href="https://news.example.com/siemens" target="_blank" rel="noopener noreferrer"');
  });

  it("filters by the security search parameter and renders the auto refresh when the cache is stale", async () => {
    const { sap } = await seed();

    const tree = await render(sap);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findElement(tree, NewsAutoRefresh)).toBeDefined();
    expect(findElement(tree, NewsFilter)?.props.selected).toBe(sap);
    expect((findElement(tree, NewsList)?.props.articles as { title: string }[]).map((a) => a.title)).toEqual([
      "SAP hebt Prognose an",
    ]);
    expect(renderText(tree)).toContain("Nachrichten werden aktualisiert …");
  });

  it("passes the Security context (held flag, change today) of each listed Security to the list", async () => {
    const { sap, siemens } = await seed();
    await prisma.price.createMany({
      data: [
        { securityId: sap, date: "2026-10-23", source: "PROVIDER", price: "100", fetchedAt: "2026-10-23T18:00:00.000Z" },
        { securityId: sap, date: "2026-10-26", source: "PROVIDER", price: "101.8", fetchedAt: "2026-10-26T09:00:00.000Z" },
      ],
    });

    const tree = await render();

    expect(findElement(tree, NewsList)?.props.context).toEqual({
      [sap]: { held: true, changeToday: "0.018", stale: false, priceDate: "2026-10-26" },
      [siemens]: { held: true, changeToday: null, stale: false, priceDate: null },
    });
    expect(renderText(tree)).toContain("SAP SE im Depot +1,80\u00a0% heute SAP hebt Prognose an");
  });

  it("adds watched Securities and narrows them with the scope toggle (Alle · Depot · Watchlist)", async () => {
    const { sap } = await seed();
    const idea = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" });
    if (!idea.ok) throw new Error("setup failed");
    const list = await createWatchlist({ name: "Ideen" });
    if (!list.ok) throw new Error("setup failed");
    for (const id of [idea.security.id, sap]) {
      const entry = await addWatchlistEntry({ watchlistId: list.watchlist.id, security: { id } }, "2026-10-26");
      if (!entry.ok) throw new Error("setup failed");
    }
    await prisma.newsArticle.create({
      data: {
        securityId: idea.security.id,
        title: "Apple stellt vor",
        url: "https://news.example.com/apple",
        source: "Beispiel Zeitung",
        publishedAt: "2026-10-26T07:00:00.000Z",
        provider: "GOOGLE_NEWS",
        fetchedAt: "2026-10-26T09:00:00.000Z",
      },
    });
    const titles = (tree: unknown) => (findElement(tree, NewsList)?.props.articles as { title: string }[]).map((a) => a.title);

    const all = await render();
    expect(titles(all)).toEqual(["Apple stellt vor", "Siemens baut Werk aus", "SAP hebt Prognose an"]);
    expect(findElement(all, NewsFilter)?.props.scope).toBe("all");
    expect(renderText(all)).toContain("Alle Depot Watchlist");

    expect(titles(await render(undefined, "held"))).toEqual(["Siemens baut Werk aus", "SAP hebt Prognose an"]);
    const watched = await render(undefined, "watched");
    expect(titles(watched)).toEqual(["Apple stellt vor", "SAP hebt Prognose an"]);
    expect((findElement(watched, NewsFilter)?.props.securities as { name: string }[]).map((s) => s.name)).toEqual(["Apple Inc.", "SAP SE"]);
    // An unknown scope falls back to "all".
    expect(findElement(await render(undefined, "bogus"), NewsFilter)?.props.scope).toBe("all");
  });

  it("lists all headlines for an unknown security parameter", async () => {
    await seed();
    const tree = await render("unknown");
    expect(findElement(tree, NewsList)?.props.articles).toHaveLength(2);
  });
});
