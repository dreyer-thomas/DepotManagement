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
import { NewsAutoRefresh } from "../../_components/news/NewsAutoRefresh";
import { NewsFilter } from "../../_components/news/NewsFilter";
import { NewsList } from "../../_components/news/NewsList";
import NewsPage from "./page";

const render = (security?: string) => NewsPage({ searchParams: Promise.resolve(security ? { security } : {}) });

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-26T10:00:00.000Z"), toFake: ["Date"] });
  await prisma.newsArticle.deleteMany();
  await prisma.newsFetch.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.depot.deleteMany();
  await prisma.security.deleteMany();
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
    });
    expect((findElement(tree, NewsList)?.props.articles as { title: string }[]).map((a) => a.title)).toEqual([
      "Siemens baut Werk aus",
      "SAP hebt Prognose an",
    ]);
    const text = renderText(tree);
    expect(text).toContain("Siemens AG Siemens baut Werk aus Beispiel Zeitung · 26.10.2026");
    expect(text).toContain("SAP SE SAP hebt Prognose an Beispiel Zeitung · 25.10.2026");
    expect(text).not.toContain("drei Wochen");
    const html = renderHtml(tree);
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

  it("lists all headlines for an unknown security parameter", async () => {
    await seed();
    const tree = await render("unknown");
    expect(findElement(tree, NewsList)?.props.articles).toHaveLength(2);
  });
});
