import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));

import { prisma } from "@/db";
import { addDays } from "@/core/dates";
import { ExactDecimal } from "@/core/decimal";
import { formatMoney, formatPercent } from "@/core/format";
import { DEFAULT_PERIOD, type PeriodSelection } from "@/core/period";
import { PERIOD_COOKIE } from "@/app/_actions/period-cookie";
import {
  archiveDepot,
  createDepot,
  depotValuation,
  ensureSecurity,
  listDepots,
  listPositions,
  portfolioValuation,
  recordTrade,
  recordTransaction,
  type RecordTransactionInput,
} from "@/modules/ledger";
import { hasValidIsinCheckDigit } from "@/modules/ledger/securities";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";
import { CompositionCard, type CompositionCardProps } from "../../_components/composition/CompositionCard";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { NewTransactionFab } from "../../_components/overview/NewTransactionFab";
import { PeriodSelector } from "../../_components/period/PeriodSelector";
import OverviewLoading from "./loading";
import OverviewPage from "./page";

const TODAY = "2026-10-26";

/** A synthetic ISIN: the 11-character body plus its valid check digit. */
function isin(body: string): string {
  for (let digit = 0; digit <= 9; digit++) {
    if (hasValidIsinCheckDigit(`${body}${digit}`)) return `${body}${digit}`;
  }
  throw new Error(`no check digit for ${body}`);
}

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  vi.useFakeTimers({ now: new Date(`${TODAY}T10:00:00.000Z`), toFake: ["Date"] });
  cookieJar.clear();
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
  vi.unstubAllGlobals();
  await prisma.$disconnect();
  dbFile.removeFiles();
});

async function depot(name: string) {
  const result = await createDepot({ name, broker: "COMDIRECT" });
  if (!result.ok) throw new Error("setup failed");
  return result.depot.id;
}

async function book(input: RecordTransactionInput) {
  const result = await recordTransaction(input);
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

async function security(isin: string, name: string, assetType: "STOCK" | "ETF" = "STOCK") {
  const result = await ensureSecurity({ isin }, { name, assetType });
  if (!result.ok) throw new Error("setup failed");
  return result.security.id;
}

async function buy(depotId: string, securityId: string, date: string, quantity: string, price: string) {
  const result = await recordTrade({ depotId, type: "BUY", date, quantity, price, security: { id: securityId } });
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
}

/** The HTML from `marker` up to (not including) `endMarker`. */
function section(html: string, marker: string, endMarker: string): string {
  const start = html.indexOf(marker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`section ${marker} not rendered`);
  return html.slice(start, end);
}

/** The hero card's HTML up to the breakdown. */
function heroHtml(html: string): string {
  const start = html.indexOf('aria-label="Portfoliowert"');
  const end = html.indexOf("Aufschlüsselung", start);
  if (start < 0 || end < 0) throw new Error("hero card not rendered");
  return html.slice(start, end);
}

const text = (html: string) =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\n]+/g, " ")
    .trim();

/** Two Depots with trades, Deposits, a dividend and a tax; one archived Depot with a Deposit. */
async function twoDepots() {
  const a = await depot("Hauptdepot");
  const b = await depot("Zweitdepot");
  const apple = await security("US0378331005", "Apple Inc.");
  const world = await security("IE00B4L5Y983", "Welt ETF", "ETF");
  await book({ depotId: a, type: "DEPOSIT", date: "2025-09-01", amount: "5000" });
  await buy(a, apple, "2025-09-02", "10", "150");
  await book({ depotId: a, type: "DIVIDEND", date: "2026-02-15", amount: "12.5", tax: "3.3", security: { id: apple } });
  await book({ depotId: b, type: "DEPOSIT", date: "2026-01-10", amount: "3000" });
  await buy(b, world, "2026-01-11", "20", "80");
  await book({ depotId: b, type: "TAX", date: "2026-04-01", tax: "4.2" });
  const prices = [
    { securityId: apple, date: "2026-06-30", price: "170" },
    { securityId: apple, date: addDays(TODAY, -1), price: "181.4" },
    { securityId: world, date: addDays(TODAY, -2), price: "93.21" },
  ];
  for (const p of prices) {
    await prisma.price.create({ data: { ...p, source: "PROVIDER", fetchedAt: `${p.date}T18:00:00.000Z` } });
  }
  const old = await depot("Altdepot");
  await book({ depotId: old, type: "DEPOSIT", date: "2026-01-01", amount: "100" });
  await book({ depotId: old, type: "WITHDRAWAL", date: "2026-01-02", amount: "100" });
  expect((await archiveDepot(old)).ok).toBe(true);
  return { a, b, apple, world, old };
}

const sum = (...values: string[]) => values.reduce((total, value) => total.plus(value), new ExactDecimal(0)).toFixed();

describe("Overview page", () => {
  it("shows the empty state with 'Depot anlegen' and an enabled 'Aus Parqet übernehmen' link", async () => {
    const tree = await OverviewPage();
    expect(findElement(tree, CreateDepotButton)?.props.label).toBe("Depot anlegen");
    const text = renderText(tree);
    expect(text).toContain("Noch kein Depot.");
    expect(text).toContain("Depot anlegen");
    const html = renderHtml(tree);
    expect(html).toMatch(/<a[^>]*href="\/settings\/parqet"[^>]*>Aus Parqet übernehmen/);
    expect(html).not.toMatch(/disabled[^>]*>Aus Parqet übernehmen/);
  });

  it("says all Depots are archived when only archived ones exist", async () => {
    const old = await depot("Altdepot");
    expect((await archiveDepot(old)).ok).toBe(true);
    const tree = await OverviewPage();
    const text = renderText(tree);
    expect(text).toContain("Alle Depots sind archiviert.");
    expect(text).not.toContain("Noch kein Depot.");
    expect(text).not.toContain("Altdepot");
    expect(renderHtml(tree)).toMatch(/<a[^>]*href="\/depots"[^>]*>Zu den Depots<\/a>/);
  });

  it("shows 'Noch keine Buchungen.', the FAB and zero Depot rows when no Depot has a Transaction", async () => {
    const a = await depot("Hauptdepot");
    const b = await depot("Zweitdepot");
    const tree = await OverviewPage();
    const html = renderHtml(tree);
    const page = renderText(tree);
    expect(page).toContain("Noch keine Buchungen.");
    expect(findElement(tree, PeriodSelector)).toBeUndefined();
    expect(findElement(tree, NewTransactionFab)?.props.depots).toEqual([
      { id: a, name: "Hauptdepot" },
      { id: b, name: "Zweitdepot" },
    ]);
    expect(html).not.toContain('aria-label="Portfoliowert"');
    expect(page).not.toContain("Top-Positionen");
    expect(page).not.toContain("Nachrichten");
    expect(page).not.toContain("veraltet");
    expect(html).toContain(`href="/depots/${a}"`);
    expect(html).toContain(`href="/depots/${b}"`);
    expect(page).toContain("Hauptdepot 0,00 € 0,00 € – –");
  });

  it("sums the non-archived Depots in hero and KPIs and lists each Depot with its detail-page figures", async () => {
    const { a, b } = await twoDepots();
    const tree = await OverviewPage();
    const html = renderHtml(tree);
    const options = { storedPrices: storedPriceHistory };
    const va = await depotValuation(a, DEFAULT_PERIOD, TODAY, undefined, options);
    const vb = await depotValuation(b, DEFAULT_PERIOD, TODAY, undefined, options);
    const [ea, eb] = [va.series.at(-1)!, vb.series.at(-1)!];

    const hero = text(heroHtml(html));
    expect(hero).toContain(`Gesamtwert ${formatMoney(sum(ea.value, eb.value))}`.replace(/\u00a0/g, " "));
    expect(hero).toContain(formatMoney(sum(va.performance.gain, vb.performance.gain), { sign: true }).replace(/ /g, " "));
    const portfolio = await portfolioValuation(DEFAULT_PERIOD, TODAY, undefined, options);
    expect(portfolio.performance.ttwror).not.toBeNull();
    expect(portfolio.performance.xirr).not.toBeNull();
    expect(hero).toContain(`TTWROR ${formatPercent(portfolio.performance.ttwror!)}`.replace(/\u00a0/g, " "));
    expect(hero).toContain(`XIRR ${formatPercent(portfolio.performance.xirr!)}`.replace(/\u00a0/g, " "));
    // Top-Positionen value Apple with the stored price (10 × 181,4), not the trade price.
    expect(text(section(html, 'id="overview-top-positions"', 'id="overview-composition"'))).toContain("1.814,00 €");
    expect(heroHtml(html)).toContain('role="figure"');
    const kpis = text(section(html, "Aufschlüsselung", 'id="overview-top-positions"'));
    expect(kpis).toContain(`Investiertes Kapital ${formatMoney(sum(ea.investedCapital, eb.investedCapital))}`.replace(/ /g, " "));
    expect(kpis).toContain(`Dividenden · 1J ${formatMoney(sum(va.dividends, vb.dividends))}`.replace(/ /g, " "));
    expect(kpis).toContain(`Guthaben ${formatMoney(sum(ea.cash, eb.cash))}`.replace(/ /g, " "));
    expect(kpis).toContain(`Steuern gezahlt · 1J ${formatMoney(sum(va.taxesPaid, vb.taxesPaid))}`.replace(/ /g, " "));
    expect(kpis).toContain("Steuern gezahlt · 1J 7,50 €");

    // Depots card: table (md+) with headers and row links, plus the stacked phone list.
    const depots = section(html, 'id="overview-depots"', 'id="overview-news"');
    expect(depots).toContain("<table");
    expect(text(depots)).toContain("Depot Wert G/V · 1J TTWROR XIRR");
    for (const [id, name, valuation] of [
      [a, "Hauptdepot", va],
      [b, "Zweitdepot", vb],
    ] as const) {
      const links = depots.match(new RegExp(`<a[^>]*href="/depots/${id}"`, "g")) ?? [];
      expect(links).toHaveLength(2);
      const ratio = (value: string | null) => (value === null ? "–" : formatPercent(value).replace(/ /g, " "));
      const row = `${name} ${formatMoney(valuation.series.at(-1)!.value)} ${formatMoney(valuation.performance.gain, { sign: true })} ${ratio(valuation.performance.ttwror)} ${ratio(valuation.performance.xirr)}`;
      expect(text(depots)).toContain(row.replace(/ /g, " "));
      expect(text(depots)).toContain(
        `${name} ${formatMoney(valuation.series.at(-1)!.value)} ${formatMoney(valuation.performance.gain, { sign: true })} TTWROR ${ratio(valuation.performance.ttwror)} · XIRR ${ratio(valuation.performance.xirr)}`.replace(/ /g, " "),
      );
    }
    expect(renderText(tree)).not.toContain("Altdepot");
    expect(findElement(tree, PeriodSelector)).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows Zusammensetzung beside Top-Positionen: Typ by default, three views, Positions-tab values plus cash", async () => {
    const { a, b } = await twoDepots();
    cookieJar.set(PERIOD_COOKIE, "1M");
    const tree = await OverviewPage();
    const html = renderHtml(tree);
    // Row order per mockup: Top-Positionen | Zusammensetzung, then Depots | Nachrichten.
    const order = ["overview-top-positions", "overview-composition", "overview-depots", "overview-news"].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1]))).toBe(true);
    const card = section(html, 'id="overview-composition"', 'id="overview-depots"');
    const buttons = card.match(/<button[^>]*value="(position|type|depot)"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(card).toContain('aria-label="Aufteilung"');
    expect(card).toMatch(/<button[^>]*aria-pressed="true"[^>]*value="type"|<button[^>]*value="type"[^>]*aria-pressed="true"/);

    const depots = (await listDepots()).filter((d) => !d.archived);
    const positions = (await Promise.all([a, b].map((id) => listPositions(id, TODAY, undefined, { storedPrices: latestStoredPrices })))).flat();
    const value = (name: string) => positions.find((p) => p.security.name === name)!.value!;
    const cash = sum(...depots.map((d) => d.cashBalance));
    const legend = text(card);
    const rows = [...legend.matchAll(/(ETF|Aktie|Guthaben) (\d+,\d) % ([\d.,]+) €/g)];
    expect(rows.map((r) => r[1])).toEqual(["ETF", "Aktie", "Guthaben"]);
    expect(rows.map((r) => r[3])).toEqual(
      [value("Welt ETF"), value("Apple Inc."), cash].map((amount) => formatMoney(amount).replace(/\u00a0€$/, "")),
    );
    const percent = sum(...rows.map((r) => r[2].replace(",", ".")));
    expect(percent).toBe("100");
    expect(card).toMatch(/role="img"[^>]*aria-label="Zusammensetzung nach Typ: ETF /);

    const views = (findElement(tree, CompositionCard)!.props as CompositionCardProps).views;
    expect(views.map((v) => v.view)).toEqual(["position", "type", "depot"]);
    const total = sum(value("Welt ETF"), value("Apple Inc."), cash);
    for (const v of views) {
      expect(sum(...v.segments.map((s) => s.amount))).toBe(total);
      expect(v.segments.at(-1)).toMatchObject({ kind: "cash", label: "Guthaben", amount: cash });
    }
    expect(views[2].segments.map((s) => s.label)).toEqual(["Zweitdepot", "Hauptdepot", "Guthaben"]);
  });

  it("uses the stored Period: with MAX the Depot rows equal each Depot's MAX figures", async () => {
    const { a, b } = await twoDepots();
    cookieJar.set(PERIOD_COOKIE, "MAX");
    const max: PeriodSelection = { kind: "preset", preset: "MAX" };
    const html = renderHtml(await OverviewPage());
    const depots = text(section(html, 'id="overview-depots"', 'id="overview-news"'));
    expect(depots).toContain("Depot Wert G/V · Max TTWROR XIRR");
    const ratio = (value: string | null) => (value === null ? "–" : formatPercent(value));
    for (const [id, name] of [
      [a, "Hauptdepot"],
      [b, "Zweitdepot"],
    ] as const) {
      const valuation = await depotValuation(id, max, TODAY, undefined, { storedPrices: storedPriceHistory });
      const row = `${name} ${formatMoney(valuation.series.at(-1)!.value)} ${formatMoney(valuation.performance.gain, { sign: true })} ${ratio(valuation.performance.ttwror)} ${ratio(valuation.performance.xirr)}`;
      expect(depots).toContain(row.replace(/\u00a0/g, " "));
    }
  });

  it("shows the stale Alert above the hero with the count of held Securities with a stale price", async () => {
    const a = await depot("Hauptdepot");
    const fresh = await security("US0378331005", "Apple Inc.");
    const s1 = await security("DE0007164600", "SAP SE");
    const s2 = await security("DE0007100000", "Mercedes AG");
    const sold = await security("DE0005140008", "Deutsche Bank AG");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "10000" });
    await buy(a, fresh, TODAY, "1", "100");
    await buy(a, s1, addDays(TODAY, -5), "1", "100");
    await buy(a, s2, addDays(TODAY, -5), "1", "100");
    await buy(a, sold, addDays(TODAY, -9), "1", "100");
    const sell = await recordTrade({ depotId: a, type: "SELL", date: addDays(TODAY, -8), quantity: "1", price: "100", security: { id: sold } });
    expect(sell.ok).toBe(true);
    const html = renderHtml(await OverviewPage());
    const alert = html.indexOf("Kurse für 2 Wertpapiere veraltet.");
    expect(alert).toBeGreaterThan(0);
    expect(alert).toBeLessThan(html.indexOf('aria-label="Portfoliowert"'));
    expect(html.slice(alert, html.indexOf('aria-label="Portfoliowert"'))).toMatch(
      /^Kurse für 2 Wertpapiere veraltet\. (<style[^>]*>[^<]*<\/style>)*<a[^>]*href="\/securities"[^>]*>Wertpapiere ansehen<\/a>/,
    );
    const top = section(html, 'id="overview-top-positions"', 'id="overview-composition"');
    expect((top.match(/data-stale-badge/g) ?? []).length).toBe(2);
    expect(text(top)).toMatch(/SAP SE Kurs vom \d\d\.\d\d\.2026 – veraltet/);
    expect(text(top)).toMatch(/Mercedes AG Kurs vom \d\d\.\d\d\.2026 – veraltet/);
    expect(text(top)).not.toMatch(/Apple Inc\. Kurs vom/);
    expect(text(top)).toContain("Apple Inc.");
  });

  it("leaves an archived Depot's stale Position out of the stale count, top Positions and Depots card", async () => {
    const a = await depot("Hauptdepot");
    const old = await depot("Altdepot");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    await buy(a, await security("US0378331005", "Apple Inc."), addDays(TODAY, -5), "1", "100");
    await book({ depotId: old, type: "DEPOSIT", date: "2026-01-02", amount: "10000" });
    await buy(old, await security("DE0007164600", "SAP SE"), addDays(TODAY, -5), "10", "500");
    // The archive guard needs an empty Depot; set the flag directly so the exclusion itself is exercised.
    await prisma.depot.update({ where: { id: old }, data: { archived: true } });
    const html = renderHtml(await OverviewPage());
    expect(html).toContain("Kurs für 1 Wertpapier veraltet.");
    const page = text(html);
    expect(page).not.toContain("SAP SE");
    expect(page).not.toContain("Altdepot");
    expect(html).not.toContain(`href="/depots/${old}"`);
    expect(text(heroHtml(html))).toContain("Gesamtwert 1.000,00 €");
    expect(text(section(html, 'id="overview-composition"', 'id="overview-depots"'))).toMatch(/Aktie 10,0 % 100,00 € Guthaben 90,0 % 900,00 €/);
  });

  it("leaves archived Depots out of every composition view", async () => {
    const a = await depot("Hauptdepot");
    const old = await depot("Altdepot");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    await buy(a, await security("US0378331005", "Apple Inc."), TODAY, "1", "100");
    await book({ depotId: old, type: "DEPOSIT", date: "2026-01-02", amount: "10000" });
    await buy(old, await security("DE0007164600", "SAP SE", "ETF"), TODAY, "10", "500");
    await prisma.depot.update({ where: { id: old }, data: { archived: true } });
    const views = (findElement(await OverviewPage(), CompositionCard)!.props as CompositionCardProps).views;
    expect(views.map((v) => v.segments.map((s) => [s.label, s.amount]))).toEqual([
      [
        ["Apple Inc.", "100"],
        ["Guthaben", "900"],
      ],
      [
        ["Aktie", "100"],
        ["Guthaben", "900"],
      ],
      [
        ["Hauptdepot", "100"],
        ["Guthaben", "900"],
      ],
    ]);
  });

  it("has no stale Alert when every held price is fresh", async () => {
    const a = await depot("Hauptdepot");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    await buy(a, await security("US0378331005", "Apple Inc."), addDays(TODAY, -3), "1", "100");
    expect(renderText(await OverviewPage())).not.toContain("veraltet");
  });

  it("lists the five largest open Positions across Depots, value descending, without links", async () => {
    const a = await depot("Hauptdepot");
    const b = await depot("Zweitdepot");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "100000" });
    await book({ depotId: b, type: "DEPOSIT", date: "2026-01-02", amount: "100000" });
    const values: [string, string, string][] = [
      [a, "Alpha AG", "300"],
      [b, "Beta AG", "900"],
      [a, "Gamma AG", "100"],
      [b, "Delta AG", "700"],
      [a, "Epsilon AG", "500"],
      [b, "Zeta AG", "50"],
    ];
    let index = 0;
    for (const [depotId, name, price] of values) {
      const id = await security(isin(`DE00000000${index++}`), name);
      await buy(depotId, id, TODAY, "1", price);
    }
    // The same Security in two Depots is two rows.
    const shared = await prisma.security.findFirstOrThrow({ where: { name: "Gamma AG" } });
    await buy(b, shared.id, TODAY, "2", "100");
    const html = renderHtml(await OverviewPage());
    const top = text(section(html, 'id="overview-top-positions"', 'id="overview-composition"'));
    expect(top).toMatch(
      /Beta AG Aktie · Zweitdepot · 1 Stück 900,00 € .*Delta AG Aktie · Zweitdepot · 1 Stück 700,00 € .*Epsilon AG Aktie · Hauptdepot · 1 Stück 500,00 € .*Alpha AG Aktie · Hauptdepot · 1 Stück 300,00 € .*Gamma AG Aktie · Zweitdepot · 2 Stück 200,00 €/,
    );
    expect(top).not.toContain("Zeta AG");
    expect(top).not.toContain("Gamma AG Aktie · Hauptdepot");
    expect(section(html, 'id="overview-top-positions"', 'id="overview-composition"')).not.toContain("<a");
  });

  it("shows the three newest headlines with external links and a link to all news", async () => {
    const a = await depot("Hauptdepot");
    const apple = await security("US0378331005", "Apple Inc.");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    await buy(a, apple, TODAY, "1", "100");
    await prisma.newsArticle.createMany({
      data: [1, 2, 3, 4, 5].map((day) => ({
        securityId: apple,
        url: `https://news.example/${day}`,
        title: `Meldung ${day}`,
        source: "Beispielquelle",
        publishedAt: `2026-10-${String(20 + day).padStart(2, "0")}T08:00:00.000Z`,
        provider: "GOOGLE_NEWS" as const,
        fetchedAt: `${TODAY}T08:00:00.000Z`,
      })),
    });
    const html = renderHtml(await OverviewPage());
    const news = section(html, 'id="overview-news"', "</section>");
    expect(text(news)).toMatch(/Meldung 5 .*Meldung 4 .*Meldung 3 /);
    expect(text(news)).not.toContain("Meldung 2");
    expect(news).toMatch(/<a[^>]*href="https:\/\/news\.example\/5"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(text(news)).toContain("Meldung 5 (öffnet in neuem Tab) Beispielquelle · 25.10.2026");
    expect(news).toMatch(/<a[^>]*href="\/news"[^>]*>Alle Nachrichten<\/a>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says when there is no news and when no Position is open", async () => {
    const a = await depot("Hauptdepot");
    await book({ depotId: a, type: "DEPOSIT", date: "2026-01-02", amount: "1000" });
    const page = renderText(await OverviewPage());
    expect(page).toContain("Keine offenen Positionen.");
    expect(page).toContain("Keine Nachrichten der letzten 14 Tage.");
  });
});

describe("Overview loading", () => {
  it("renders Skeletons in a busy region labelled 'Übersicht wird geladen'", () => {
    const html = renderHtml(OverviewLoading());
    expect(html).toMatch(/aria-busy="true"/);
    expect(html).toContain('aria-label="Übersicht wird geladen"');
    expect(html).toContain("MuiSkeleton");
  });
});
