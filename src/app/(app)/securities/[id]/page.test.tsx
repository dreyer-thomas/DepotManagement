import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../../test/helpers/next-mocks";
import { renderHtml } from "../../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

class NotFoundError extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));

import { prisma } from "@/db";
import { addDays } from "@/core/dates";
import { PERIOD_COOKIE } from "@/app/_actions/period-cookie";
import { archiveDepot, createDepot, ensureSecurity, recordIsinChange, recordSplit, recordTransaction, type RecordTransactionInput } from "@/modules/ledger";
import { SecurityActions } from "../../../_components/security-detail/SecurityActions";
import { SecurityHero } from "../../../_components/security-detail/SecurityHero";
import { MOVING_AVERAGE_COOKIE, SECURITY_CHART_COOKIE } from "../../../_components/charts/chart-preference";
import { securityDetail } from "@/modules/ledger";
import { setMapping, storedPriceHistory } from "@/modules/prices";
import { addWatchlistEntry, createWatchlist } from "@/modules/watchlist";
import { setManualClassification } from "@/modules/classification";
import { WatchHeader } from "../../../_components/security-detail/WatchHeader";
import { WatchlistCard } from "../../../_components/security-detail/WatchlistCard";
import { KeyFiguresCard } from "../../../_components/security-detail/KeyFiguresCard";
import { AddToWatchlistButton } from "../../../_components/watchlists/WatchlistEntryDialog";
import SecurityDetailPage, { generateMetadata } from "./page";

const TODAY = "2026-10-26";

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date(`${TODAY}T10:00:00.000Z`), toFake: ["Date"] });
  cookieJar.clear();
  cookieJar.set(PERIOD_COOKIE, "MAX");
  await prisma.watchlistEntry.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.securityClassification.deleteMany();
  await prisma.securityKeyFigures.deleteMany();
  await prisma.newsArticle.deleteMany();
  await prisma.newsFetch.deleteMany();
  await prisma.price.deleteMany();
  await prisma.corporateAction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const props = (id: string, depot?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(depot ? { depot } : {}),
});

async function depot(name: string) {
  const result = await createDepot({ name, broker: "COMDIRECT" });
  if (!result.ok) throw new Error("setup failed");
  return result.depot.id;
}

async function security(name = "Welt ETF") {
  const result = await ensureSecurity({ isin: "IE00B4L5Y983" }, { name, assetType: "ETF" });
  if (!result.ok) throw new Error("setup failed");
  return result.security.id;
}

async function book(input: RecordTransactionInput) {
  const result = await recordTransaction(input);
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

async function providerPrice(securityId: string, date: string, price: string) {
  await prisma.price.create({ data: { securityId, date, price, source: "PROVIDER", fetchedAt: `${date}T18:00:00.000Z` } });
}

/** The HTML from `marker` up to (not including) `endMarker`. */
function section(html: string, marker: string, endMarker?: string): string {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`${marker} not rendered`);
  const end = endMarker ? html.indexOf(endMarker, start) : html.length;
  return html.slice(start, end < 0 ? html.length : end);
}

function text(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two Depots (Alpha, Beta) holding the Security; price 110 yesterday. */
async function twoDepots() {
  const a = await depot("Alpha");
  const b = await depot("Beta");
  const id = await security();
  await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
  await book({ depotId: b, type: "BUY", date: "2026-03-02", quantity: "5", price: "120", security: { id } });
  await book({ depotId: b, type: "DIVIDEND", date: "2026-04-01", amount: "20", tax: "5", security: { id } });
  await providerPrice(id, addDays(TODAY, -1), "110");
  return { a, b, id };
}

describe("Security detail page", () => {
  it("calls notFound() for an unknown id", async () => {
    await expect(SecurityDetailPage(props("nope"))).rejects.toBeInstanceOf(NotFoundError);
    expect(await generateMetadata(props("nope"))).toEqual({ title: "Wertpapier nicht gefunden" });
  });

  it("Watch layout: header with Period change, Kurs chart with overlay, Auf Watchlists, news and classification; no holding blocks", async () => {
    const id = await security();
    await providerPrice(id, "2025-03-01", "100");
    await providerPrice(id, addDays(TODAY, -1), "110");
    const list = await createWatchlist({ name: "Ideen" });
    if (!list.ok) throw new Error("setup failed");
    const entry = await addWatchlistEntry({ watchlistId: list.watchlist.id, security: { id }, note: "Zeile 1\nZeile 2", dateAdded: "2025-03-01" }, TODAY);
    if (!entry.ok) throw new Error("setup failed");
    await prisma.newsArticle.create({
      data: { securityId: id, url: "https://news.example/w", title: "Welt-Idee", source: "Quelle", provider: "GOOGLE_NEWS", publishedAt: `${addDays(TODAY, -1)}T08:00:00.000Z`, fetchedAt: `${TODAY}T08:00:00.000Z` },
    });

    const tree = await SecurityDetailPage(props(id));
    const html = renderHtml(tree);
    expect(html).toMatch(/<a(?=[^>]*aria-label="Zurück zu Wertpapiere")(?=[^>]*href="\/securities")[^>]*>/);
    const page = text(html);
    expect(page).toContain("IE00B4L5Y983 · ETF");
    expect(page).not.toContain("Noch keine Buchungen.");
    // MAX starts on the first stored Price: 100 → 110.
    const header = text(section(html, 'aria-label="Kurs"', 'id="security-watchlists"'));
    expect(header).toContain("110,00 €");
    expect(header).toContain("+10,00 € · Max +10,00 %");
    expect(header).toContain("Kurs vom 25.10.2026");
    expect(header).toContain("Gleitender Durchschnitt");
    expect(header).not.toContain("Wert");
    expect(html).not.toContain('aria-label="Diagramm"');
    const chart = findElement(tree, WatchHeader)!.props.chart as { props: Record<string, unknown> };
    expect(chart.props.valuePoints).toEqual([]);
    expect((chart.props.pricePoints as { date: string }[])[0].date).toBe("2025-03-01");

    const card = text(section(html, 'id="security-watchlists"', 'id="security-news"'));
    expect(card).toContain("Auf Watchlists");
    expect(card).toContain("Ideen");
    expect(card).toContain("Aufgenommen 01.03.2025 · seit Aufnahme +10,00 %");
    expect(card).toContain("Zeile 1 Zeile 2");
    expect(card).toContain("Bearbeiten");
    expect(section(html, 'id="security-watchlists"', 'id="security-news"')).toContain(`href="/watchlists?list=${list.watchlist.id}"`);
    expect(findElement(tree, WatchlistCard)!.props.entries).toEqual([expect.objectContaining({ note: "Zeile 1\nZeile 2", source: "APP" })]);

    expect(text(section(html, 'id="security-news"', 'id="security-classification"'))).toContain("Welt-Idee");
    expect(text(section(html, 'id="security-classification"'))).toContain("Klassifizierung");
    // A stored manual classification wins over the asset-type default.
    expect(await setManualClassification(id, { sector: "Halbleiter" })).toMatchObject({ ok: true });
    const classified = text(section(renderHtml(await SecurityDetailPage(props(id))), 'id="security-classification"'));
    expect(classified).toMatch(/Halbleiter/);
    expect(html).toContain('aria-label="Klassifizierung bearbeiten – Welt ETF"');

    // List chip in the header, "Zur Watchlist" with this list as already containing the Security.
    expect(section(html, "<h1", 'aria-label="Kurs"')).toContain(`href="/watchlists?list=${list.watchlist.id}"`);
    const add = findElement(tree, AddToWatchlistButton)!;
    expect(add.props.onLists).toEqual([list.watchlist.id]);
    expect(add.props.lists).toEqual([{ id: list.watchlist.id, name: "Ideen" }]);
    expect(page).toContain("Zur Watchlist");

    for (const block of ['aria-label="Depot"', 'aria-label="Wert"', 'id="security-total"', 'id="security-heatmap"', 'id="security-lots"', 'id="security-transactions"']) {
      expect(html).not.toContain(block);
    }
    expect(findElement(tree, SecurityHero)).toBeUndefined();
    expect(findElement(tree, SecurityActions)!.props.transactionDepots).toEqual([]);
    expect(await generateMetadata(props(id))).toEqual({ title: "Welt ETF" });
  });

  it("Watch layout without Price or lists: Kein Kurs vorhanden, change –, no chart, no Auf Watchlists", async () => {
    const id = await security();
    const tree = await SecurityDetailPage(props(id));
    const html = renderHtml(tree);
    const header = text(section(html, 'aria-label="Kurs"', 'id="security-news"'));
    expect(header).toContain("Kein Kurs vorhanden.");
    expect(header).toMatch(/Kurs – – Kein Kurs vorhanden\./);
    expect(findElement(tree, WatchHeader)!.props.chart).toBeUndefined();
    expect(html).not.toContain('id="security-watchlists"');
    expect(html).toContain('id="security-classification"');
    expect(findElement(tree, AddToWatchlistButton)!.props.lists).toEqual([]);
  });

  it("Kennzahlen in both layouts: snapshot with source and date, 52-week figures, refresh only when held or watched", async () => {
    const result = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
    if (!result.ok) throw new Error("setup failed");
    const id = result.security.id;
    expect((await setMapping(id, { provider: "YAHOO", symbol: "SAP.DE" })).ok).toBe(true);
    await providerPrice(id, "2026-01-15", "120");
    await providerPrice(id, addDays(TODAY, -1), "108");
    await prisma.securityKeyFigures.create({
      data: { securityId: id, symbol: "SAP.DE", kind: "stock", figures: JSON.stringify({ trailingPE: "30.4321", dividendYield: "0.0118" }), fetchedAt: "2026-10-18T09:00:00.000Z" },
    });

    // Neither held nor watched: the card shows, without the refresh button.
    let tree = await SecurityDetailPage(props(id));
    let card = findElement(tree, KeyFiguresCard)!;
    expect(card.props).toMatchObject({ assetType: "STOCK", canRefresh: false, snapshot: { asOf: "2026-10-18", stale: true } });
    expect(card.props.fiftyTwoWeek).toMatchObject({ high: { price: "120", date: "2026-01-15" }, distanceToHigh: "-0.1" });
    let html = renderHtml(tree);
    const watchCard = text(section(html, 'id="security-key-figures"', 'id="security-news"'));
    expect(watchCard).toContain("Yahoo Finance, Stand 18.10.2026 – veraltet");
    expect(watchCard).toContain("KGV 30,43");
    expect(watchCard).toContain("KGV erwartet –");
    expect(watchCard).toContain("52-Wochen-Hoch 120,00 € (15.01.2026)");
    expect(watchCard).toContain("auf Schlusskursbasis");
    expect(watchCard).toContain("Angaben ohne Gewähr, keine Anlageberatung");
    expect(watchCard).not.toContain("Kennzahlen aktualisieren");

    // Watched only (never booked, not held): refreshable in the watch layout.
    const list = await createWatchlist({ name: "Ideen" });
    if (!list.ok) throw new Error("setup failed");
    expect((await addWatchlistEntry({ watchlistId: list.watchlist.id, security: { id } }, TODAY)).ok).toBe(true);
    tree = await SecurityDetailPage(props(id));
    expect(findElement(tree, WatchHeader)).toBeDefined();
    expect(findElement(tree, KeyFiguresCard)!.props.canRefresh).toBe(true);
    await prisma.watchlistEntry.deleteMany();

    // Booked and held: after "Gesamt seit Erstkauf", with the refresh button.
    const a = await depot("Alpha");
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "1", price: "100", security: { id } });
    tree = await SecurityDetailPage(props(id));
    card = findElement(tree, KeyFiguresCard)!;
    expect(card.props.canRefresh).toBe(true);
    html = renderHtml(tree);
    expect(html.indexOf('id="security-total"')).toBeLessThan(html.indexOf('id="security-key-figures"'));
    expect(text(section(html, 'id="security-key-figures"'))).toContain("Kennzahlen aktualisieren");
  });

  it("sums the non-archived Depots under Alle Depots", async () => {
    const { a, b, id } = await twoDepots();
    const tree = await SecurityDetailPage(props(id));
    const html = renderHtml(tree);
    expect(html).toMatch(/<h1[^>]*>Welt ETF<\/h1>/);
    expect(text(html)).toContain("IE00B4L5Y983 · ETF");

    const nav = section(html, 'aria-label="Depot"', "</nav>");
    expect(nav).toMatch(/<a[^>]*aria-current="page"[^>]*>Alle Depots<\/a>|<a[^>]*href="\/securities\/[^"?]*"[^>]*aria-current="page"[^>]*>Alle Depots/);
    expect(nav).toContain(`href="/securities/${id}?depot=${a}"`);
    expect(nav).toContain(`href="/securities/${id}?depot=${b}"`);
    expect((nav.match(/aria-current="page"/g) ?? []).length).toBe(1);

    const hero = text(section(html, 'aria-label="Wert"', "Aufschlüsselung"));
    expect(hero).toContain("Wert · 15 Stück à 110,00 €");
    expect(hero).toContain("1.650,00 €");
    // Gain: 1.650 − 1.600 invested + 20 dividends.
    expect(hero).toContain("+70,00 €");
    expect(hero).toContain("Kurs vom 25.10.2026");
    expect(hero).not.toContain("Keine Kursquelle");

    const kpis = text(section(html, 'aria-label="Kennzahlen"', 'id="security-lots"'));
    expect(kpis).toMatch(/Stück 15 Cost Basis 1\.600,00 € Unrealisiert \+50,00 € Dividenden · Max 20,00 € Ø Kaufkurs 106,67 €/);

    const lots = text(section(html, 'id="security-lots"', 'id="security-transactions"'));
    expect(lots).toMatch(/Alpha .*02\.02\.2026 10 1\.000,00 € 100,00 € .*Beta .*02\.03\.2026 5 600,00 € 120,00 €/);

    const history = text(section(html, 'id="security-transactions"', 'id="security-news"'));
    expect(history).toMatch(/01\.04\.2026 Dividende Beta 20,00 € .*02\.03\.2026 Kauf Beta 5 Stück 600,00 € .*02\.02\.2026 Kauf Alpha 10 Stück 1\.000,00 €/);

    expect(text(section(html, 'id="security-news"'))).toContain("Keine Nachrichten der letzten 14 Tage.");

    // "Neue Buchung" asks for one of the non-archived booking Depots.
    const actions = findElement(tree, SecurityActions);
    expect(actions?.props.transactionDepots).toEqual([
      { id: a, name: "Alpha" },
      { id: b, name: "Beta" },
    ]);
  });

  it("shows one Depot's figures when it is selected, equal to its Positions-tab row", async () => {
    const { a, id } = await twoDepots();
    const tree = await SecurityDetailPage(props(id, a));
    const html = renderHtml(tree);
    const nav = section(html, 'aria-label="Depot"', "</nav>");
    expect(nav).toMatch(new RegExp(`<a[^>]*(href="/securities/${id}\\?depot=${a}"[^>]*aria-current="page"|aria-current="page"[^>]*href="/securities/${id}\\?depot=${a}")`));
    const hero = text(section(html, 'aria-label="Wert"', "Aufschlüsselung"));
    expect(hero).toContain("Wert · 10 Stück à 110,00 €");
    expect(hero).toContain("1.100,00 €");
    const kpis = text(section(html, 'aria-label="Kennzahlen"', 'id="security-lots"'));
    expect(kpis).toMatch(/Stück 10 Cost Basis 1\.000,00 € Unrealisiert \+100,00 € Dividenden · Max 0,00 € Ø Kaufkurs 100,00 €/);
    const history = text(section(html, 'id="security-transactions"', 'id="security-news"'));
    expect(history).not.toContain("Beta");
    expect(findElement(tree, SecurityActions)?.props.transactionDepots).toEqual([{ id: a, name: "Alpha" }]);
  });

  it("flags a stale price of a held Security with the manual price action", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    await providerPrice(id, addDays(TODAY, -6), "105");
    const html = renderHtml(await SecurityDetailPage(props(id)));
    const hero = text(section(html, 'aria-label="Wert"', "Aufschlüsselung"));
    expect(hero).toContain("Kurs vom 20.10.2026 – veraltet");
    expect(hero).toContain("Keine Kursquelle liefert aktuelle Kurse.");
    expect(section(html, 'aria-label="Wert"', "Aufschlüsselung")).toContain('aria-label="Kurs manuell eintragen – Welt ETF"');
  });

  it("shows this Security's news only", async () => {
    const a = await depot("Alpha");
    const id = await security();
    const other = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" });
    if (!other.ok) throw new Error("setup failed");
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "1", price: "100", security: { id: other.security.id } });
    await prisma.newsArticle.createMany({
      data: [
        { securityId: id, url: "https://news.example/1", title: "Welt-Meldung", source: "Quelle", provider: "GOOGLE_NEWS", publishedAt: `${addDays(TODAY, -1)}T08:00:00.000Z`, fetchedAt: `${TODAY}T08:00:00.000Z` },
        { securityId: other.security.id, url: "https://news.example/2", title: "Apple-Meldung", source: "Quelle", provider: "GOOGLE_NEWS", publishedAt: `${addDays(TODAY, -1)}T08:00:00.000Z`, fetchedAt: `${TODAY}T08:00:00.000Z` },
      ],
    });
    const news = text(section(renderHtml(await SecurityDetailPage(props(id))), 'id="security-news"'));
    expect(news).toContain("Welt-Meldung");
    expect(news).not.toContain("Apple-Meldung");
  });

  it("shows a news item with a teaser as an accordion with the Kurztext marker", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    await prisma.newsArticle.create({
      data: {
        securityId: id,
        url: "https://finance.example.com/welt",
        title: "Welt-Meldung mit Kurztext",
        source: "Muster Finanz",
        provider: "YAHOO_RSS",
        teaser: "Ein erfundener Kurztext zur Welt-Meldung.",
        publishedAt: `${addDays(TODAY, -1)}T08:00:00.000Z`,
        fetchedAt: `${TODAY}T08:00:00.000Z`,
      },
    });
    const html = section(renderHtml(await SecurityDetailPage(props(id))), 'id="security-news"');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(html).toMatch(/role="region"[^>]*hidden=""/);
    const news = text(html);
    expect(news).toContain("Welt-Meldung mit Kurztext");
    expect(news).toContain("Kurztext");
    expect(news).toContain("Ein erfundener Kurztext zur Welt-Meldung.");
    expect(news).toContain("Zum Artikel");
    expect(html).toContain('href="https://finance.example.com/welt" target="_blank" rel="noopener noreferrer"');
  });

  it("Booked: full layout plus the list chips and Zur Watchlist; news through the Security's own articles", async () => {
    const { id } = await twoDepots();
    const list = await createWatchlist({ name: "Dividenden" });
    if (!list.ok) throw new Error("setup failed");
    const entry = await addWatchlistEntry({ watchlistId: list.watchlist.id, security: { id } }, TODAY);
    if (!entry.ok) throw new Error("setup failed");
    const other = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" });
    if (!other.ok) throw new Error("setup failed");
    const at = { source: "Quelle", provider: "GOOGLE_NEWS" as const, publishedAt: `${addDays(TODAY, -1)}T08:00:00.000Z`, fetchedAt: `${TODAY}T08:00:00.000Z` };
    await prisma.newsArticle.createMany({
      data: [
        { securityId: id, url: "https://news.example/own", title: "Eigene Meldung", ...at },
        { securityId: other.security.id, url: "https://news.example/other", title: "Fremde Meldung", ...at },
      ],
    });
    const tree = await SecurityDetailPage(props(id));
    const html = renderHtml(tree);
    expect(findElement(tree, SecurityHero)).toBeDefined();
    expect(findElement(tree, WatchHeader)).toBeUndefined();
    expect(html).not.toContain('id="security-watchlists"');
    expect(html).not.toContain('id="security-classification"');
    expect(section(html, "<h1", 'aria-label="Depot"')).toContain(`href="/watchlists?list=${list.watchlist.id}"`);
    expect(findElement(tree, AddToWatchlistButton)!.props.onLists).toEqual([list.watchlist.id]);
    const news = text(section(html, 'id="security-news"'));
    expect(news).toContain("Eigene Meldung");
    expect(news).not.toContain("Fremde Meldung");
  });

  it("shows a fully sold Security with its realized gain and no lots", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", fee: "1", security: { id } });
    await book({ depotId: a, type: "SELL", date: "2026-05-04", quantity: "10", price: "120", fee: "1", security: { id } });
    const html = renderHtml(await SecurityDetailPage(props(id)));
    const hero = text(section(html, 'aria-label="Wert"', "Aufschlüsselung"));
    expect(hero).toContain("Wert · 0 Stück à 120,00 €");
    expect(hero).toContain("+198,00 €");
    // Sold: an old price is not flagged as missing a source.
    expect(hero).not.toContain("Keine Kursquelle");
    const kpis = text(section(html, 'aria-label="Kennzahlen"', 'id="security-lots"'));
    expect(kpis).toMatch(/Stück 0 .*Ø Kaufkurs –/);
    expect(text(section(html, 'id="security-lots"', 'id="security-transactions"'))).toContain("Keine offenen Kaufposten.");
  });

  it("defaults to the archived Depot when it is the only one and offers no Neue Buchung", async () => {
    const d = await depot("Altdepot");
    const id = await security();
    await book({ depotId: d, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    await book({ depotId: d, type: "SELL", date: "2026-03-02", quantity: "10", price: "100", security: { id } });
    expect((await archiveDepot(d)).ok).toBe(true);
    const tree = await SecurityDetailPage(props(id));
    const nav = section(renderHtml(tree), 'aria-label="Depot"', "</nav>");
    expect(text(nav.slice(nav.indexOf(">") + 1))).toBe("Altdepot (archiviert)");
    expect(nav).toContain('aria-current="page"');
    expect(findElement(tree, SecurityActions)?.props.transactionDepots).toEqual([]);
  });

  it("shows split-adjusted quantities after a split", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    expect((await recordSplit({ securityId: id, date: "2026-06-01", ratio: "1:2" })).ok).toBe(true);
    const html = renderHtml(await SecurityDetailPage(props(id)));
    expect(text(section(html, 'aria-label="Kennzahlen"', 'id="security-lots"'))).toMatch(/Stück 20 .*Ø Kaufkurs 50,00 €/);
    expect(text(section(html, 'id="security-transactions"', 'id="security-news"'))).toContain(
      "20 Stück split-bereinigt (gebucht: 10 Stück)",
    );
  });

  it("shows the same figures on the old and the new Security of an ISIN change", async () => {
    const a = await depot("Alpha");
    const id = await security("Alt ETF");
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    const change = await recordIsinChange({
      oldSecurityId: id,
      newSecurity: { new: { isin: "US0378331005", name: "Neu ETF", assetType: "ETF" } },
      date: "2026-06-01",
      oldQuantity: "10",
      newQuantity: "10",
    });
    if (!change.ok) throw new Error("setup failed");
    const newId = change.isinChange.newSecurity.id;
    await providerPrice(newId, addDays(TODAY, -1), "110");
    const figures = async (securityId: string) => {
      const html = renderHtml(await SecurityDetailPage(props(securityId)));
      return {
        h1: html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1],
        hero: text(section(html, 'aria-label="Wert"', "Aufschlüsselung")),
        history: text(section(html, 'id="security-transactions"', 'id="security-news"')),
      };
    };
    const old = await figures(id);
    const neu = await figures(newId);
    expect(old.h1).toBe("Alt ETF");
    expect(neu.h1).toBe("Neu ETF");
    expect(neu.hero).toBe(old.hero);
    expect(neu.hero).toContain("Wert · 10 Stück à 110,00 €");
    // The new Security's history names the old one under the type.
    expect(neu.history).toContain("Kauf Alt ETF Alpha 10 Stück");
  });

  it("shows Stand and the value chart for a custom Period ending before today", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    await book({ depotId: a, type: "BUY", date: "2026-08-03", quantity: "5", price: "130", security: { id } });
    await providerPrice(id, "2026-05-04", "105");
    await providerPrice(id, addDays(TODAY, -1), "140");

    cookieJar.set(PERIOD_COOKIE, "custom:2026-03-01:2026-06-30");
    const custom = section(renderHtml(await SecurityDetailPage(props(id))), 'aria-label="Wert"', "Aufschlüsselung");
    expect(text(custom)).toContain("Wert · 10 Stück à 105,00 €");
    expect(text(custom)).toContain("1.050,00 €");
    expect(text(custom)).toContain("Stand 30.06.2026");
    expect(custom).toMatch(/<div[^>]*role="figure"/);

    cookieJar.set(PERIOD_COOKIE, "MAX");
    const max = section(renderHtml(await SecurityDetailPage(props(id))), 'aria-label="Wert"', "Aufschlüsselung");
    expect(text(max)).not.toContain("Stand ");
    expect(text(max)).toContain("Wert · 15 Stück à 140,00 €");
    expect(max).toMatch(/<div[^>]*role="figure"/);
  });

  it("shows Gesamt seit Erstkauf after the KPIs, identical for every Period", async () => {
    const { id } = await twoDepots();
    const card = async () => text(section(renderHtml(await SecurityDetailPage(props(id))), 'id="security-total"', 'id="security-lots"'));
    const max = await card();
    // Realized 0, unrealized 1.650 − 1.600, dividends 20; taxes 5 separate; invested 1.600; 70 / 1.600.
    expect(max).toMatch(
      /Gesamt seit Erstkauf Realisiert 0,00 € Unrealisiert \+50,00 € Dividenden \+20,00 € Gebühren 0,00 € Gesamt \+70,00 € Steuern gezahlt nicht in Gewinn\/Verlust enthalten \+5,00 € Investiert gesamt 1\.600,00 € Rendite auf Investiert \+4,38 % XIRR \+\d+,\d\d %/,
    );
    cookieJar.set(PERIOD_COOKIE, "1M");
    expect(await card()).toBe(max);
    cookieJar.set(PERIOD_COOKIE, "custom:2026-03-01:2026-03-31");
    expect(await card()).toBe(max);

    // The card sits between the KPIs and the lots.
    const html = renderHtml(await SecurityDetailPage(props(id)));
    expect(html.indexOf('aria-label="Kennzahlen"')).toBeLessThan(html.indexOf('id="security-total"'));
  });

  it("shows the Kurs/Wert toggle with the price chart and its trade markers by default", async () => {
    const { id } = await twoDepots();
    const hero = section(renderHtml(await SecurityDetailPage(props(id))), 'aria-label="Wert"', "Aufschlüsselung");
    expect(hero).toMatch(/role="group"[^>]*aria-label="Diagramm"|aria-label="Diagramm"[^>]*role="group"/);
    expect(text(hero)).toMatch(/Kurs Wert/);
    const pressed = [...hero.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(pressed).toEqual(["Kurs"]);
    const label = hero.match(/role="figure"[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*role="figure"/);
    expect((label?.[1] ?? label?.[2])?.replace(/\u00a0/g, " ")).toMatch(/^Kursverlauf 02\.02\.2026 – 26\.10\.2026: Kurs von 100,00 € auf 110,00 €, 2 Käufe, 0 Verkäufe$/);
  });

  it("offers Drawdown with trade and dividend markers for a sold Security and opens the stored mode", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2026-02-02", quantity: "10", price: "100", security: { id } });
    await book({ depotId: a, type: "DIVIDEND", date: "2026-03-02", amount: "8", tax: "2", security: { id } });
    await providerPrice(id, "2026-03-10", "80");
    await book({ depotId: a, type: "SELL", date: "2026-05-04", quantity: "10", price: "90", security: { id } });
    const detail = (await securityDetail(id, undefined, { kind: "preset", preset: "MAX" }, TODAY, undefined, { storedPrices: storedPriceHistory }))!;
    expect(detail.drawdown.max).toBe("-0.2");

    const tree = await SecurityDetailPage(props(id));
    // The chart is the hero's `chart` element.
    const chartOf = (node: unknown) => findElement(node, SecurityHero)!.props.chart as { props: Record<string, unknown> };
    const chart = chartOf(tree);
    expect(chart.props.initialMode).toBe("price");
    expect(chart.props.drawdown).toEqual(detail.drawdown);
    expect(chart.props.dividends).toEqual([{ depotName: "Alpha", date: "2026-03-02", amount: "8" }]);
    expect(text(section(renderHtml(tree), 'aria-label="Wert"', "Aufschlüsselung"))).toMatch(/Kurs Wert Performance Drawdown/);

    cookieJar.set(SECURITY_CHART_COOKIE, "drawdown");
    const hero = section(renderHtml(await SecurityDetailPage(props(id))), 'aria-label="Wert"', "Aufschlüsselung");
    const pressed = [...hero.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(pressed).toEqual(["Drawdown"]);
    expect(text(hero)).toContain("Maximaler Drawdown -20,00 %");
    // The peak is the latest day at 100 (09.03.), unrecovered until today.
    expect(text(hero)).toContain("Dauer 231 Tage nicht erholt Periode 09.03.2026 – 26.10.2026");

    cookieJar.set(SECURITY_CHART_COOKIE, "nope");
    expect(chartOf(await SecurityDetailPage(props(id))).props.initialMode).toBe("price");
  });

  it("shows the all-time card of a fully sold Security", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2025-01-02", quantity: "10", price: "100", fee: "1", security: { id } });
    await book({ depotId: a, type: "SELL", date: "2026-01-02", quantity: "10", price: "120", fee: "1", security: { id } });
    cookieJar.set(PERIOD_COOKIE, "1M");
    const card = text(section(renderHtml(await SecurityDetailPage(props(id))), 'id="security-total"', 'id="security-lots"'));
    expect(card).toContain("Realisiert +198,00 €");
    expect(card).toContain("Unrealisiert 0,00 €");
    expect(card).toContain("Gesamt +198,00 €");
    expect(card).toContain("Investiert gesamt 1.001,00 €");
    expect(card).toContain("Rendite auf Investiert +19,78 %");
    expect(card).toContain("XIRR +19,78 %");
  });
  it("Security analyses: performance line, moving averages and stored overlay on the chart; heatmap card after the total", async () => {
    const a = await depot("Alpha");
    const id = await security();
    await book({ depotId: a, type: "BUY", date: "2025-03-03", quantity: "10", price: "100", security: { id } });
    await providerPrice(id, "2025-08-01", "120");
    await book({ depotId: a, type: "SELL", date: "2025-09-01", quantity: "10", price: "110", security: { id } });
    const detail = (await securityDetail(id, undefined, { kind: "preset", preset: "MAX" }, TODAY, undefined, { storedPrices: storedPriceHistory }))!;

    const tree = await SecurityDetailPage(props(id));
    const chart = findElement(tree, SecurityHero)!.props.chart as { props: Record<string, unknown> };
    expect(chart.props.performance).toEqual(detail.performanceLine);
    expect(chart.props.movingAverages).toEqual(detail.movingAverages);
    expect(chart.props.initialMovingAverage).toBe("off");
    expect(detail.performanceLine.at(-1)?.performance).toBe(detail.performance.ttwror);

    const html = renderHtml(tree);
    expect(html.indexOf('id="security-total"')).toBeLessThan(html.indexOf('id="security-heatmap"'));
    expect(html.indexOf('id="security-heatmap"')).toBeLessThan(html.indexOf('id="security-lots"'));
    const card = section(html, 'id="security-heatmap"', 'id="security-lots"');
    expect(text(card)).toContain("Performance-Heatmap");
    expect(text(card)).toMatch(/Jan Feb Mär .* Dez Gesamt/);
    expect(text(card)).toContain("2025");
    expect(text(card)).not.toContain("2026");
    expect(card).toContain('href="/analyses?tab=returns&amp;scope=portfolio&amp;dimension=assetClass"');
    expect(text(card)).toContain("Zur Heatmap des gesamten Portfolios");

    cookieJar.set(MOVING_AVERAGE_COOKIE, "38");
    const stored = findElement(await SecurityDetailPage(props(id)), SecurityHero)!.props.chart as { props: Record<string, unknown> };
    expect(stored.props.initialMovingAverage).toBe("38");
    cookieJar.set(MOVING_AVERAGE_COOKIE, "x");
    const invalid = findElement(await SecurityDetailPage(props(id)), SecurityHero)!.props.chart as { props: Record<string, unknown> };
    expect(invalid.props.initialMovingAverage).toBe("off");
  });
});
