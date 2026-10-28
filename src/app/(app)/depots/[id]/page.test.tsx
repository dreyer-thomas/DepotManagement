import { afterAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { renderHtml, renderText } from "../../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

class NotFoundError extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => {} }),
}));

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));

import { prisma } from "@/db";
import { findElement } from "../../../../../test/helpers/next-mocks";
import { ValueSummary, type ValueSummaryProps } from "../../../_components/valuation/ValueSummary";

import { BENCHMARK_COOKIE, VALUE_CHART_TAB_COOKIE } from "../../../_components/charts/chart-preference";
import { businessDate } from "@/core/dates";
import { DEFAULT_PERIOD } from "@/core/period";
import { storedPriceHistory } from "@/modules/prices";
import { archiveDepot, createDepot, depotValuation, ensureBenchmarkSecurities, portfolioValuation, finishReconciliation, openReconciliation, recordIsinChange, recordSplit, recordTrade, recordTransaction, type RecordTransactionInput, updateTransaction } from "@/modules/ledger";
import DepotDetailPage, { generateMetadata } from "./page";

/** The Performance tab data the page passes to the hero. */
function comparisonOf(tree: unknown) {
  return (findElement(tree, ValueSummary)!.props as ValueSummaryProps).comparison!;
}

beforeEach(async () => {
  cookieJar.clear();
  await prisma.reconciliationRun.deleteMany();
  await prisma.price.deleteMany();
  await prisma.corporateAction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const props = (id: string, tab?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(tab ? { tab } : {}),
});

/** Strict: the element with role="tab" and aria-selected="true" (either attribute order) is labelled `label`. */
function selectedTab(label: string): RegExp {
  return new RegExp(`<[^>]*(role="tab"[^>]*aria-selected="true"|aria-selected="true"[^>]*role="tab")[^>]*>${label}<`);
}

/** The hero card's HTML up to the breakdown (the Positions table has its own pills). */
function heroHtml(html: string): string {
  const start = html.indexOf('aria-label="Depotwert"');
  const end = html.indexOf("Aufschlüsselung", start);
  if (start < 0 || end < 0) throw new Error("hero card not rendered");
  return html.slice(start, end);
}

/** The accessible name of the value chart in the hero card (either attribute order), decoded. */
function chartLabel(html: string): string | undefined {
  const hero = heroHtml(html);
  const tag = hero.match(/<div[^>]*role="figure"[^>]*>/)?.[0];
  const label = tag?.match(/aria-label="([^"]*)"/)?.[1];
  return label?.replace(/&nbsp;|&#160;/g, "\u00a0").replace(/&amp;/g, "&");
}

async function depot() {
  const result = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  if (!result.ok) throw new Error("setup failed");
  return result.depot;
}

describe("Depot detail page", () => {
  it("calls notFound() for an unknown id", async () => {
    await expect(DepotDetailPage(props("xyz"))).rejects.toBeInstanceOf(NotFoundError);
    expect(await generateMetadata(props("xyz"))).toEqual({ title: "Depot nicht gefunden" });
  });

  it("opens on Positionen and shows name, Broker, Cash Account, the tabs and the empty state", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(html).toMatch(/<a(?=[^>]*aria-label="Zurück zu Depots")(?=[^>]*href="\/depots")[^>]*>/);
    expect(text).toContain("Hauptdepot");
    expect(text).toContain("comdirect");
    expect(text).toContain("Cash-Konto 0,00\u00a0€");
    expect(text).toMatch(/Positionen .*Cash-Konto .*Buchungen .*Zusammensetzung/);
    expect(html).toMatch(selectedTab("Positionen"));
    for (const tab of ["positions", "cash", "transactions", "composition"]) {
      expect(html).toContain(`href="/depots/${id}?tab=${tab}"`);
    }
    expect(text).toContain("Noch keine Buchungen.");
    const buttons = html.match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toMatch(/disabled/);
    expect(html.match(/<a[^>]*href="\/import\?depot=[^"]*"[^>]*>[\s\S]*?Dokumente importieren/g) ?? []).toHaveLength(1);
    expect(html).toContain(`href="/import?depot=${id}"`);
    expect(await generateMetadata(props(id))).toEqual({ title: "Hauptdepot" });
  });

  it("links Dokumente importieren next to Neue Buchung on a Depot with Transactions", async () => {
    const { id } = await depot();
    const result = await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-01-02", amount: "100" });
    if (!result.ok) throw new Error("setup failed");
    const html = renderHtml(await DepotDetailPage(props(id, "transactions")));
    expect((html.match(/<a[^>]*aria-label="Dokumente importieren"/g) ?? []).length).toBe(1);
    expect(html).toContain(`href="/import?depot=${id}"`);
  });

  it("lists Transactions grouped by month, newest first", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-10-01",
      quantity: "10",
      price: "123.45",
      fee: "4.9",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    await recordTrade({ depotId: id, type: "SELL", date: "2026-10-20", quantity: "2.5", price: "130", security: { id: buy.transaction.security!.id } });
    await recordTrade({ depotId: id, type: "BUY", date: "2026-09-15", quantity: "1", price: "100", security: { id: buy.transaction.security!.id } });

    const tree = await DepotDetailPage(props(id, "transactions"));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(text).not.toContain("Noch keine Buchungen.");
    expect(text).toMatch(/Oktober 2026 .*Verkauf AI Apple Inc\. 20\.10\.2026 2,5 Stück 325,00\u00a0€.*Kauf AI Apple Inc\. 01\.10\.2026 10 Stück 1\.234,50\u00a0€.*September 2026 .*Kauf .*15\.09\.2026 1 Stück 100,00\u00a0€/);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect((html.match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? []).length).toBe(1);
  });

  it("shows the empty state with one Neue Buchung button on the Buchungen tab", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "transactions"));
    expect(renderText(tree)).toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(selectedTab("Buchungen"));
    expect((renderHtml(tree).match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? []).length).toBe(1);
  });

  it("shows the empty state with one Neue Buchung button on the Cash-Konto tab", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "cash"));
    const text = renderText(tree);
    expect(text).toContain("Noch keine Buchungen.");
    expect(text).not.toContain("Dieser Bereich folgt");
    expect(renderHtml(tree)).toMatch(selectedTab("Cash-Konto"));
    expect((renderHtml(tree).match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? []).length).toBe(1);
  });

  async function bookMatrix(id: string) {
    const book = async (input: Omit<RecordTransactionInput, "depotId">) => {
      const result = await recordTransaction({ depotId: id, ...input });
      if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
      return result.transaction;
    };
    await book({ type: "FEE", date: "2026-03-02", fee: "4.9" });
    await book({ type: "WITHDRAWAL", date: "2026-03-04", amount: "300" });
    const buy = await book({
      type: "BUY",
      date: "2026-01-10",
      quantity: "10",
      price: "100",
      fee: "5",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    await book({ type: "TAX", date: "2026-03-03", tax: "-3.5" });
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "2000" });
    await book({ type: "DIVIDEND", date: "2026-03-01", amount: "50", tax: "12.5", security: { id: buy.security!.id } });
    await book({ type: "DEPOSIT", date: "2099-01-01", amount: "100" });
  }

  it("shows the Cash Account balance and booking history, newest first", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    const tree = await DepotDetailPage(props(id, "cash"));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(html).toMatch(selectedTab("Cash-Konto"));
    expect(text).toContain("Cash-Konto 731,10\u00a0€");
    expect(text).toContain("Saldo 731,10\u00a0€");
    expect(text).toMatch(/Datum .*Art .*Security .*Cash-Effekt .*Saldo/);
    expect(text).toMatch(
      new RegExp(
        [
          "01\\.01\\.2099 Einzahlung \\+100,00\u00a0€ 831,10\u00a0€",
          "04\\.03\\.2026 Auszahlung -300,00\u00a0€ 731,10\u00a0€",
          "03\\.03\\.2026 Steuer \\+3,50\u00a0€ 1\\.031,10\u00a0€",
          "02\\.03\\.2026 Gebühr -4,90\u00a0€ 1\\.027,60\u00a0€",
          "01\\.03\\.2026 Dividende AI Apple Inc\\. \\+37,50\u00a0€ 1\\.032,50\u00a0€",
          "10\\.01\\.2026 Kauf AI Apple Inc\\. -1\\.005,00\u00a0€ 995,00\u00a0€",
          "05\\.01\\.2026 Einzahlung \\+2\\.000,00\u00a0€ 2\\.000,00\u00a0€",
        ].join(" "),
      ),
    );
    expect(html).toContain("<table");
    expect((html.match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? []).length).toBe(1);
  });

  it("pins the Cash row with the current balance last in Positionen", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    const text = renderText(await DepotDetailPage(props(id)));
    expect(text).toContain("Cash-Konto 731,10\u00a0€");
    expect(text).toMatch(/AI Apple Inc\. 10 1\.005,00\u00a0€ .*Cash-Konto 731,10\u00a0€ Sortieren nach/);
    expect(text).toMatch(/Apple Inc\. 10 Stück Kurs vom 10\.01\.2026 – veraltet 1\.000,00\u00a0€ .*Cash-Konto 731,10\u00a0€$/);
  });

  it("shows the message and the Cash row for a cash-only Depot", async () => {
    const { id } = await depot();
    const result = await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-01-05", amount: "500" });
    if (!result.ok) throw new Error("setup failed");
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    expect(text).toMatch(/Keine offenen Positionen\. Cash-Konto 500,00\u00a0€ Sortieren nach/);
    expect(text).toMatch(/Keine offenen Positionen\. Cash-Konto 500,00\u00a0€$/);
    expect(renderHtml(tree).match(/data-cash-row/g)).toHaveLength(2);
  });

  it("lists non-trade Transactions with their value and cash effect on Buchungen", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    const text = renderText(await DepotDetailPage(props(id, "transactions")));
    expect(text).toMatch(/Art .*Security .*Datum .*Stück .*Betrag .*Cash-Effekt/);
    expect(text).toContain("Auszahlung 04.03.2026 300,00\u00a0€ -300,00\u00a0€");
    expect(text).toContain("Steuer 03.03.2026 -3,50\u00a0€ +3,50\u00a0€");
    expect(text).toContain("Gebühr 02.03.2026 4,90\u00a0€ -4,90\u00a0€");
    expect(text).toContain("Dividende AI Apple Inc. 01.03.2026 50,00\u00a0€ +37,50\u00a0€");
    expect(text).toContain("Kauf AI Apple Inc. 10.01.2026 10 Stück 1.000,00\u00a0€ -1.005,00\u00a0€");
    expect(text).toContain("Einzahlung 05.01.2026 2.000,00\u00a0€ +2.000,00\u00a0€");
  });

  it("shows the Zusammensetzung tab with Position and Typ only, Typ by default, Positions plus cash", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    const tree = await DepotDetailPage(props(id, "composition"));
    const html = renderHtml(tree);
    const text = renderText(tree);
    expect(html).toMatch(selectedTab("Zusammensetzung"));
    expect(html).toContain('id="depot-composition"');
    expect(html.match(/<button[^>]*value="(position|type|depot)"[^>]*>/g)?.map((tag) => tag.match(/value="(\w+)"/)?.[1])).toEqual(["position", "type"]);
    expect(text).toContain("Aktie 57,8\u00a0% 1.000,00\u00a0€ Guthaben 42,2\u00a0% 731,10\u00a0€");
    expect(html).toMatch(/role="img"[^>]*aria-label="Zusammensetzung nach Typ: Aktie 57,8(&nbsp;|\u00a0)% \(1\.000,00(&nbsp;|\u00a0)€\), Guthaben 42,2(&nbsp;|\u00a0)% \(731,10(&nbsp;|\u00a0)€\)"/);
  });

  it("shows the empty state on the Zusammensetzung tab of an empty Depot", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "composition"));
    expect(renderText(tree)).toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(selectedTab("Zusammensetzung"));
    expect(renderText(tree)).not.toContain("Keine Werte vorhanden.");
  });

  it("falls back to the Positionen tab for an unknown tab value", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "foo"));
    expect(renderText(tree)).toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(selectedTab("Positionen"));
  });

  it("shows open Positions with FIFO Cost Basis, price, value and the G/V pill", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "10",
      price: "100",
      fee: "5",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    const security = { id: buy.transaction.security!.id };
    await recordTrade({ depotId: id, type: "BUY", date: "2026-02-10", quantity: "5", price: "120", fee: "2", security });
    await recordTrade({ depotId: id, type: "SELL", date: "2026-03-10", quantity: "12", price: "130", fee: "3", security });

    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(html).toMatch(selectedTab("Positionen"));
    expect(text).toMatch(/Wertpapier .*Stück .*Einstandswert .*Ø Kaufkurs .*Kurs .*Wert .*G\/V/);
    expect(text).toContain(
      "AI Apple Inc. 3 361,20\u00a0€ 120,40\u00a0€ 130,00\u00a0€ Kurs vom 10.03.2026 – veraltet 390,00\u00a0€ +28,80\u00a0€ · +7,97\u00a0%",
    );
    expect(text).toContain("AI Apple Inc. 3 Stück Kurs vom 10.03.2026 – veraltet 390,00\u00a0€ +28,80\u00a0€ · +7,97\u00a0%");
    expect(text).toContain("Sortieren nach");
    expect(html).toContain("<table");
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*>(?:(?!<\/th>).)*Wert/);
    expect((html.match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? []).length).toBe(1);
  });

  it("links each Position's Security to its page with this Depot selected", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "10",
      price: "100",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    const html = renderHtml(await DepotDetailPage(props(id, "positions")));
    const href = `href="/securities/${buy.transaction.security!.id}?depot=${id}"`;
    // Desktop table and phone list.
    expect(html.split(href).length - 1).toBe(2);
  });

  it("values Positions with stored Prices: manual over provider over the Transaction price", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "10",
      price: "100",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    const securityId = buy.transaction.security!.id;
    const price = (date: string, source: "MANUAL" | "PROVIDER", value: string) =>
      prisma.price.create({ data: { securityId, date, source, price: value, fetchedAt: "2026-01-12T18:00:00.000Z" } });

    await price("2026-01-12", "PROVIDER", "110");
    expect(renderText(await DepotDetailPage(props(id)))).toContain("110,00\u00a0€ Kurs vom 12.01.2026 – veraltet 1.100,00\u00a0€ +100,00\u00a0€");
    await price("2026-01-12", "MANUAL", "115");
    expect(renderText(await DepotDetailPage(props(id)))).toContain("115,00\u00a0€ Kurs vom 12.01.2026 – veraltet 1.150,00\u00a0€ +150,00\u00a0€");
  });

  it("orders Positions by value descending and leaves out future-dated buys", async () => {
    const { id } = await depot();
    await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "1",
      price: "50",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-11",
      quantity: "2",
      price: "300",
      security: { new: { isin: "DE0007164600", name: "SAP SE", assetType: "STOCK" } },
    });
    await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2099-01-01",
      quantity: "1",
      price: "10",
      security: { new: { cryptoSymbol: "BTC", name: "Bitcoin", assetType: "CRYPTO" } },
    });

    const text = renderText(await DepotDetailPage(props(id)));
    expect(text).toMatch(/SAP SE 2 Stück Kurs vom 11\.01\.2026 – veraltet 600,00\u00a0€.*Apple Inc\. 1 Stück Kurs vom 10\.01\.2026 – veraltet 50,00\u00a0€/);
    expect(text).not.toContain("Bitcoin");
  });

  it("shows Keine offenen Positionen. when everything is sold", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "1",
      price: "50",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    await recordTrade({ depotId: id, type: "SELL", date: "2026-01-11", quantity: "1", price: "60", security: { id: buy.transaction.security!.id } });

    const tree = await DepotDetailPage(props(id));
    expect(renderText(tree)).toContain("Keine offenen Positionen. Cash-Konto 10,00\u00a0€");
    expect(renderText(tree)).not.toContain("Noch keine Buchungen.");
    expect((renderHtml(tree).match(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/g) ?? []).length).toBe(1);
  });

  it("gives every Buchungen row an edit button labelled with its date", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    const html = renderHtml(await DepotDetailPage(props(id, "transactions")));
    const buttons = html.match(/<button[^>]*aria-label="Buchung vom \d{2}\.\d{2}\.\d{4} bearbeiten"/g) ?? [];
    expect(buttons).toHaveLength(7);
    expect(html).toContain('aria-label="Buchung vom 10.01.2026 bearbeiten"');
    expect(html).toContain('aria-label="Buchung vom 01.01.2099 bearbeiten"');
  });

  it("shows an edit made through the ledger on the next render of every tab", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "10",
      price: "100",
      fee: "5",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-01-05", amount: "2000" });
    const edited = await updateTransaction(buy.transaction.id, {
      depotId: id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "10",
      price: "90",
      fee: "5",
      security: { id: buy.transaction.security!.id },
    });
    expect(edited.ok).toBe(true);

    const transactions = renderText(await DepotDetailPage(props(id, "transactions")));
    expect(transactions).toContain("Kauf AI Apple Inc. 10.01.2026 10 Stück 900,00\u00a0€ -905,00\u00a0€");
    const positions = renderText(await DepotDetailPage(props(id)));
    expect(positions).toContain("AI Apple Inc. 10 905,00\u00a0€ 90,50\u00a0€ 90,00\u00a0€ Kurs vom 10.01.2026 – veraltet 900,00\u00a0€");
    const cash = renderText(await DepotDetailPage(props(id, "cash")));
    expect(cash).toContain("Cash-Konto 1.095,00\u00a0€");
    expect(cash).toContain("10.01.2026 Kauf AI Apple Inc. -905,00\u00a0€ 1.095,00\u00a0€");
  });

  it("shows an archived Depot read-only on every tab", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    // Close the Position and empty the cash so the Depot can be archived.
    const apple = (await prisma.security.findFirstOrThrow()).id;
    for (const input of [
      { type: "SELL", date: "2026-03-05", quantity: "10", price: "0", security: { id: apple } },
      { type: "WITHDRAWAL", date: "2026-03-06", amount: "731.1" },
      { type: "WITHDRAWAL", date: "2099-01-02", amount: "100" },
    ] as const) {
      const result = await recordTransaction({ depotId: id, ...input });
      if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    }
    expect(await archiveDepot(id)).toMatchObject({ ok: true });

    for (const tab of ["positions", "cash", "transactions", "composition"]) {
      const tree = await DepotDetailPage(props(id, tab));
      const text = renderText(tree);
      const html = renderHtml(tree);
      expect(text).toMatch(/Hauptdepot 1T 1W 1M YTD 1J 3J Max Benutzerdefiniert comdirect Archiviert Cash-Konto/);
      expect(text).toMatch(/Archiviertes Depot – nur lesbar\. Reaktivieren unter Einstellungen ?\./);
      expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>Einstellungen<\/a>/);
      expect(html).not.toMatch(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/);
      expect(html).not.toContain("Dokumente importieren");
      expect(html).not.toContain("bearbeiten");
    }
    expect(renderText(await DepotDetailPage(props(id, "composition")))).toContain("Keine Werte vorhanden.");
    const transactions = renderHtml(await DepotDetailPage(props(id, "transactions")));
    expect(transactions).toContain("<table");
    expect(transactions).not.toContain("Aktionen");
    expect(transactions).not.toMatch(/class="[^"]*MuiTableRow-hover/);
  });

  it("shows the empty state of an archived Depot without Neue Buchung", async () => {
    const { id } = await depot();
    expect(await archiveDepot(id)).toMatchObject({ ok: true });
    const tree = await DepotDetailPage(props(id));
    expect(renderText(tree)).toContain("Noch keine Buchungen.");
    expect(renderText(tree)).toContain("Archiviert");
    expect(renderHtml(tree)).not.toMatch(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/);
    expect(renderHtml(tree)).not.toContain("Dokumente importieren");
  });

  it("shows no archive marker on an active Depot", async () => {
    const { id } = await depot();
    const text = renderText(await DepotDetailPage(props(id)));
    expect(text).not.toContain("Archiviert");
    expect(text).not.toContain("nur lesbar");
  });

  it("shows split-adjusted Positions with a row menu and split-adjusted quantities on Buchungen", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2024-01-02",
      quantity: "10",
      price: "400",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    const split = await recordSplit({ securityId: buy.transaction.security!.id, date: "2024-03-01", ratio: "1:4" });
    if (!split.ok) throw new Error("setup failed");

    const positions = await DepotDetailPage(props(id));
    expect(renderText(positions)).toContain("AI Apple Inc. 40 4.000,00\u00a0€ 100,00\u00a0€ 100,00\u00a0€ Kurs vom 02.01.2024 – veraltet 4.000,00\u00a0€");
    expect(renderHtml(positions).match(/aria-label="Aktionen für Apple Inc\."/g)).toHaveLength(2);

    const transactions = renderText(await DepotDetailPage(props(id, "transactions")));
    expect(transactions).toContain("40 Stück split-bereinigt (gebucht: 10 Stück)");
  });

  it("leaves Buchungen unadjusted for a split dated after today", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2024-01-02",
      quantity: "10",
      price: "400",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    const split = await recordSplit({ securityId: buy.transaction.security!.id, date: "2099-01-01", ratio: "1:4" });
    if (!split.ok) throw new Error("setup failed");

    const transactions = renderText(await DepotDetailPage(props(id, "transactions")));
    expect(transactions).toContain("10 Stück");
    expect(transactions).not.toContain("split-bereinigt");
  });

  it("shows the new Security's Position after an ISIN change while Buchungen keep the old Security", async () => {
    const { id } = await depot();
    const buy = await recordTrade({
      depotId: id,
      type: "BUY",
      date: "2024-01-02",
      quantity: "10",
      price: "100",
      security: { new: { isin: "US0378331005", name: "Alt AG", assetType: "STOCK" } },
    });
    if (!buy.ok) throw new Error("setup failed");
    const change = await recordIsinChange({
      oldSecurityId: buy.transaction.security!.id,
      newSecurity: { new: { isin: "US5949181045", name: "Neu AG", assetType: "STOCK" } },
      date: "2024-03-01",
      oldQuantity: "10",
      newQuantity: "5",
    });
    if (!change.ok) throw new Error("setup failed");

    const positions = await DepotDetailPage(props(id));
    const text = renderText(positions);
    expect(text).toContain("NA Neu AG 5 1.000,00\u00a0€ 200,00\u00a0€ 200,00\u00a0€ Kurs vom 02.01.2024 – veraltet 1.000,00\u00a0€");
    expect(text).not.toContain("Alt AG");
    expect(renderHtml(positions).match(/aria-label="Aktionen für Neu AG"/g)).toHaveLength(2);

    const transactions = renderText(await DepotDetailPage(props(id, "transactions")));
    expect(transactions).toContain("Alt AG");
    expect(transactions).not.toContain("Neu AG");
  });
  /** The pressed pill of the Period selector (either attribute order; text or aria-label). */
  function pressedPill(label: string): RegExp {
    return new RegExp(`<button(?=[^>]*aria-pressed="true")[^>]*(?:aria-label="${label}"[^>]*>|>${label}<)`);
  }

  it("shows the value summary for the stored custom Period with its label in the captions", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    cookieJar.set("dm_period", "custom:2026-01-01:2026-06-30");
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(html).toContain('aria-label="Zeitraum"');
    expect(html).toMatch(pressedPill("Benutzerdefiniert"));
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(text).toMatch(/Hauptdepot 1T 1W 1M YTD 1J 3J Max Benutzerdefiniert comdirect/);
    expect(text).toContain(
      [
        "Gesamtwert 1.731,10\u00a0€ Stand 30.06.2026",
        // Period Gain/Loss: 1.731,10 − 0 − (2000 − 300 + 3,50 refund − 12,50 dividend tax) = 40,10.
        "+40,10\u00a0€ · TTWROR +2,00\u00a0% XIRR +4,69\u00a0%",
        // The chart tabs of the hero card.
        "Wertentwicklung Performance Drawdown",
        "Aufschlüsselung",
        "Realisiert 0,00\u00a0€ Unrealisiert -5,00\u00a0€ Dividenden +50,00\u00a0€ Gebühren -4,90\u00a0€",
        "Steuern gezahlt nicht in Gewinn/Verlust enthalten +9,00\u00a0€",
        "Ordergebühren stecken in realisiert/unrealisiert.",
        "Investiertes Kapital 1.005,00\u00a0€",
        "Dividenden · 01.01.2026 – 30.06.2026 50,00\u00a0€",
        "Guthaben 731,10\u00a0€",
        "Steuern gezahlt · 01.01.2026 – 30.06.2026 9,00\u00a0€",
      ].join(" "),
    );
    // Gain: green tone with an upward arrow; the breakdown is a collapsed accordion.
    expect(heroHtml(html)).toMatch(/<svg[^>]*data-testid="ArrowUpwardIcon"/);
    expect(heroHtml(html)).not.toContain('data-testid="ArrowDownwardIcon"');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?Aufschlüsselung/);
    // Valid markup: the separator before "Steuern gezahlt" sits between two lists, not inside one.
    const lists = html.match(/<dl[^>]*>[\s\S]*?<\/dl>/g) ?? [];
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list).not.toMatch(/<hr/);
      // Only dt/dd directly inside the list: strip each dt/dd element, nothing else may remain.
      // (Emotion's inline <style> tags of the test render are not markup children of the list.)
      const body = list
        .replace(/^<dl[^>]*>|<\/dl>$/g, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
        .replace(/<(dt|dd)\b[^>]*>[\s\S]*?<\/\1>/g, "");
      expect(body).toBe("");
    }
    expect(lists[1]).toContain("Steuern gezahlt");
    // The summary sits above the tabs.
    expect(text.indexOf("Gesamtwert")).toBeLessThan(text.indexOf("Positionen"));
    // The value chart in the hero names the Period and the first/last series values; its last value
    // is the "Gesamtwert" text.
    const label = chartLabel(html);
    expect(label).toBe(
      "Wertentwicklung 01.01.2026 – 30.06.2026: Wert von 0,00\u00a0€ auf 1.731,10\u00a0€, " +
        "investiertes Kapital von 0,00\u00a0€ auf 1.005,00\u00a0€",
    );
    const gesamtwert = text.match(/Gesamtwert (\S+\u00a0€)/)?.[1];
    expect(label).toContain(`auf ${gesamtwert!}, investiertes Kapital`);
  });

  it("passes the Depot drawdown and the stored chart tab to the hero", async () => {
    const { id } = await depot();
    await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-02-01", amount: "1000" });
    const tree = await DepotDetailPage(props(id));
    const valuation = await depotValuation(id, DEFAULT_PERIOD, businessDate(new Date()), undefined, { storedPrices: storedPriceHistory });
    const summary = findElement(tree, ValueSummary)!;
    expect(summary.props.drawdown).toEqual(valuation.drawdown);
    expect(summary.props.chartTab).toBe("performance");

    cookieJar.set(VALUE_CHART_TAB_COOKIE, "drawdown");
    const html = renderHtml(await DepotDetailPage(props(id)));
    expect(heroHtml(html)).toContain("Maximaler Drawdown");
    expect(chartLabel(html)).toMatch(/^Drawdown .*: maximaler Drawdown 0,00\u00a0%$/);
  });

  it("offers indices, Gesamtportfolio and the other non-archived Depots on the Performance tab, never itself", async () => {
    const { id } = await depot();
    const other = await createDepot({ name: "Zweitdepot", broker: "COMDIRECT" });
    const archived = await createDepot({ name: "Altdepot", broker: "COMDIRECT" });
    if (!other.ok || !archived.ok) throw new Error("setup failed");
    await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-02-01", amount: "1000" });
    await recordTransaction({ depotId: other.depot.id, type: "DEPOSIT", date: "2026-03-01", amount: "500" });
    expect(await archiveDepot(archived.depot.id)).toMatchObject({ ok: true });
    cookieJar.set("dm_period", "custom:2026-01-01:2026-06-30");

    const valuation = await depotValuation(id, { kind: "custom", from: "2026-01-01", to: "2026-06-30" }, businessDate(new Date()), undefined, {
      storedPrices: storedPriceHistory,
    });
    const portfolio = await portfolioValuation({ kind: "custom", from: "2026-01-01", to: "2026-06-30" }, businessDate(new Date()), undefined, {
      storedPrices: storedPriceHistory,
    });
    const comparison = comparisonOf(await DepotDetailPage(props(id)));
    expect(comparison.scopeLabel).toBe("Hauptdepot");
    expect(comparison.line).toEqual(valuation.performanceLine);
    expect(comparison.line.at(-1)!.performance).toBe(valuation.performance.ttwror ?? "0");
    // The KPI return is the hero's Period TTWROR, not the line end.
    expect(comparison.ttwror).toBe(valuation.performance.ttwror);
    expect(comparison.options.map((option) => [option.key, option.label])).toEqual([
      ["msci-world", "MSCI World"],
      ["msci-acwi", "MSCI ACWI"],
      ["dax", "DAX"],
      ["sp500", "S&P 500"],
      ["portfolio", "Gesamtportfolio"],
      [`depot:${other.depot.id}`, "Zweitdepot"],
    ]);
    // No benchmark Security yet: no line, no return.
    expect(comparison.options.slice(0, 4).every((option) => option.line === null && option.ttwror === null)).toBe(true);
    expect(comparison.options[4].line).toEqual(portfolio.performanceLine);
    expect(comparison.options[4].ttwror).toBe(portfolio.performance.ttwror);
    expect(comparison.options[5].ttwror).toBe(portfolio.depots.find((entry) => entry.id === other.depot.id)!.valuation.performance.ttwror);
    expect(comparison.options[5].line!.map((point) => point.date)).toEqual(comparison.line.map((point) => point.date));

    cookieJar.set(BENCHMARK_COOKIE, "portfolio");
    expect(comparisonOf(await DepotDetailPage(props(id))).initialChoice).toBe("portfolio");
    cookieJar.set(BENCHMARK_COOKIE, `depot:${id}`);
    expect(comparisonOf(await DepotDetailPage(props(id))).initialChoice).toBe("none");

    // A chosen index without prices: the hint instead of a second line, no comparison KPIs.
    cookieJar.set(BENCHMARK_COOKIE, "dax");
    cookieJar.set(VALUE_CHART_TAB_COOKIE, "ttwror");
    const hero = heroHtml(renderHtml(await DepotDetailPage(props(id))));
    expect(hero).toContain("Vergleich mit");
    expect(hero).toContain("Keine Kurse für den Vergleich");
    expect(hero).not.toContain("Differenz");
  });

  it("aligns Gesamtportfolio and an earlier-started Depot to the Depot's own MAX Period, starting at 0", async () => {
    const { id } = await depot();
    const other = await createDepot({ name: "Zweitdepot", broker: "COMDIRECT" });
    if (!other.ok) throw new Error("setup failed");
    await recordTransaction({ depotId: other.depot.id, type: "DEPOSIT", date: "2026-01-15", amount: "500" });
    await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-03-01", amount: "1000" });
    cookieJar.set("dm_period", "MAX");

    const today = businessDate(new Date());
    const valuation = await depotValuation(id, { kind: "preset", preset: "MAX" }, today, undefined, { storedPrices: storedPriceHistory });
    expect(valuation.start.date).toBe("2026-02-28");
    const comparison = comparisonOf(await DepotDetailPage(props(id)));
    const dates = comparison.line.map((point) => point.date);
    expect(comparison.line[0]).toEqual({ date: "2026-02-28", performance: "0" });
    expect(dates.at(-1)).toBe(today);
    const portfolio = comparison.options.find((option) => option.key === "portfolio")!;
    const zweitdepot = comparison.options.find((option) => option.key === `depot:${other.depot.id}`)!;
    for (const option of [portfolio, zweitdepot]) {
      expect(option.line![0]).toEqual({ date: "2026-02-28", performance: "0" });
      expect(option.line!.map((point) => point.date)).toEqual(dates);
    }
    // Same AD-10 valuation as the Depot pages over exactly the Depot's Period.
    const custom = await portfolioValuation({ kind: "custom", from: valuation.from, to: valuation.to }, today, undefined, {
      storedPrices: storedPriceHistory,
    });
    expect(portfolio.line).toEqual(custom.performanceLine);
    expect(portfolio.ttwror).toBe(custom.performance.ttwror);
  });

  it("draws a priced index on the Depot's dates, based on the last close on or before the start point", async () => {
    const { id } = await depot();
    await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-03-01", amount: "1000" });
    const [world] = await ensureBenchmarkSecurities();
    const close = (date: string, price: string) =>
      prisma.price.create({ data: { securityId: world, date, source: "PROVIDER", price, fetchedAt: `${date}T18:00:00.000Z` } });
    // Friday close before the Saturday start point (2026-02-28), then a later close.
    await close("2026-02-27", "100");
    await close("2026-03-10", "110");
    cookieJar.set("dm_period", "MAX");

    const comparison = comparisonOf(await DepotDetailPage(props(id)));
    const msciWorld = comparison.options.find((option) => option.key === "msci-world")!;
    expect(msciWorld.line!.map((point) => point.date)).toEqual(comparison.line.map((point) => point.date));
    expect(msciWorld.line![0]).toEqual({ date: "2026-02-28", performance: "0" });
    expect(msciWorld.line!.find((point) => point.date === "2026-03-09")!.performance).toBe("0");
    expect(msciWorld.line!.find((point) => point.date === "2026-03-10")!.performance).toBe("0.1");
    expect(msciWorld.line!.at(-1)!.performance).toBe("0.1");
    expect(msciWorld.ttwror).toBe("0.1");
    // The benchmark ETF is no Position of the Depot.
    expect(renderText(await DepotDetailPage(props(id)))).not.toContain("iShares Core MSCI World");

    cookieJar.set(BENCHMARK_COOKIE, "msci-world");
    cookieJar.set(VALUE_CHART_TAB_COOKIE, "ttwror");
    const hero = heroHtml(renderHtml(await DepotDetailPage(props(id))));
    expect(hero).toContain("MSCI World");
    expect(hero).toContain("+10,00\u00a0%");
    expect(hero).not.toContain("Keine Kurse für den Vergleich");
  });

  it("shows a Period loss with the loss tone, a downward arrow and a minus sign", async () => {
    const { id } = await depot();
    const book = async (input: Omit<RecordTransactionInput, "depotId">) => {
      const result = await recordTransaction({ depotId: id, ...input });
      if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
      return result.transaction;
    };
    await book({ type: "DEPOSIT", date: "2026-01-05", amount: "1000" });
    const buy = await book({
      type: "BUY",
      date: "2026-01-05",
      quantity: "10",
      price: "100",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    await prisma.price.create({
      data: { securityId: buy.security!.id, date: "2026-02-01", source: "PROVIDER", price: "80", fetchedAt: "2026-02-01T18:00:00.000Z" },
    });
    cookieJar.set("dm_period", "custom:2026-01-01:2026-02-28");
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(text).toContain("Gesamtwert 800,00\u00a0€ Stand 28.02.2026 -200,00\u00a0€ · TTWROR -20,00\u00a0% XIRR -77,87\u00a0% Wertentwicklung Performance Drawdown Aufschlüsselung");
    expect(text).toContain("Unrealisiert -200,00\u00a0€");
    expect(heroHtml(html)).toMatch(/<svg[^>]*data-testid="ArrowDownwardIcon"/);
    expect(heroHtml(html)).not.toContain('data-testid="ArrowUpwardIcon"');
  });

  it("shows a neutral zero pill and XIRR – when nothing was invested in the Period", async () => {
    const { id } = await depot();
    const deposit = await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2025-03-01", amount: "500" });
    const withdrawal = await recordTransaction({ depotId: id, type: "WITHDRAWAL", date: "2025-04-01", amount: "500" });
    if (!deposit.ok || !withdrawal.ok) throw new Error("setup failed");
    cookieJar.set("dm_period", "custom:2026-01-01:2026-01-31");
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const hero = heroHtml(renderHtml(tree));
    expect(text).toContain("Gesamtwert 0,00\u00a0€ Stand 31.01.2026 0,00\u00a0€ XIRR – Wertentwicklung Performance Drawdown Aufschlüsselung");
    const heroText = text.slice(text.indexOf("Gesamtwert"), text.indexOf("Aufschlüsselung"));
    expect(heroText).not.toBe("");
    expect(heroText).not.toContain("TTWROR");
    expect(hero).not.toMatch(/data-testid="Arrow(Up|Down)wardIcon"/);
  });

    it("defaults to 1J for a missing or invalid cookie and values with stored Prices up to today", async () => {
    // 1J is relative to today: pin the clock so the 2026 bookings stay inside it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00+01:00"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { id } = await depot();
    await bookMatrix(id);
    const apple = (await prisma.security.findFirstOrThrow()).id;
    await prisma.price.create({
      data: { securityId: apple, date: "2026-03-10", source: "PROVIDER", price: "120", fetchedAt: "2026-03-10T18:00:00.000Z" },
    });
    for (const stored of [undefined, "custom:2026-13-01:x"]) {
      if (stored) cookieJar.set("dm_period", stored);
      const tree = await DepotDetailPage(props(id));
      const text = renderText(tree);
      expect(renderHtml(tree)).toMatch(pressedPill("1J"));
      expect(text).toContain("Gesamtwert 1.931,10\u00a0€ +240,10\u00a0€ · TTWROR +13,79\u00a0% XIRR +17,26\u00a0% Wertentwicklung Performance Drawdown Aufschlüsselung");
      expect(text).toMatch(/Investiertes Kapital 1\.005,00\u00a0€/);
      expect(text).toContain("Dividenden · 1J 50,00\u00a0€");
      expect(text).toContain("Steuern gezahlt · 1J 9,00\u00a0€");
      expect(text).not.toContain("Stand ");
    }
  });

  it("shows the summary of an archived Depot read-only", async () => {
    const { id } = await depot();
    const deposit = await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-01-05", amount: "500" });
    const withdrawal = await recordTransaction({ depotId: id, type: "WITHDRAWAL", date: "2026-01-06", amount: "500" });
    if (!deposit.ok || !withdrawal.ok) throw new Error("setup failed");
    expect(await archiveDepot(id)).toMatchObject({ ok: true });
    cookieJar.set("dm_period", "MAX");
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(html).toMatch(pressedPill("Max"));
    // Deposit and full Withdrawal: no gain; the breakdown is still shown read-only.
    expect(text).toContain("Gesamtwert 0,00\u00a0€ 0,00\u00a0€ · TTWROR 0,00\u00a0% XIRR 0,00\u00a0% Wertentwicklung Performance Drawdown Aufschlüsselung");
    expect(text).toContain("Aufschlüsselung Realisiert 0,00\u00a0€ Unrealisiert 0,00\u00a0€ Dividenden 0,00\u00a0€ Gebühren 0,00\u00a0€");
    expect(text).toContain("Investiertes Kapital 0,00\u00a0€");
    expect(heroHtml(html)).not.toMatch(/data-testid="Arrow(Up|Down)wardIcon"/);
    expect(text).toContain("Dividenden · Max 0,00\u00a0€");
    expect(html).not.toMatch(/<button[^>]*aria-label="Neue Buchung"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Neu<\/span>/);
    expect(html).not.toContain("bearbeiten");
    // The archived Depot shows the value chart too.
    expect(chartLabel(html)).toMatch(
      /^Wertentwicklung 05\.01\.2026 – \d{2}\.\d{2}\.\d{4}: Wert von 500,00\u00a0€ auf 0,00\u00a0€, investiertes Kapital von 0,00\u00a0€ auf 0,00\u00a0€$/,
    );
  });

  it("shows no summary and no Period selector for an empty Depot", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id));
    expect(renderText(tree)).not.toContain("Gesamtwert");
    expect(renderHtml(tree)).not.toContain('aria-label="Zeitraum"');
  });
});

describe("Depot detail reconciliation", () => {
  it("offers ⋮ Depot abgleichen, then shows the open run and the last finished statement date", async () => {
    const { id } = await depot();
    let html = renderHtml(await DepotDetailPage(props(id)));
    expect(html).toContain('aria-label="Depot-Aktionen"');
    expect(renderText(await DepotDetailPage(props(id)))).not.toContain("Zuletzt abgeglichen");

    const opened = await openReconciliation(id, "2026-10-20", "2026-10-26");
    if (!opened.ok) throw new Error("setup failed");
    html = renderHtml(await DepotDetailPage(props(id)));
    expect(html).toMatch(new RegExp(`<a[^>]*href="/depots/${id}/reconcile"[^>]*>Abgleich fortsetzen \\(Stichtag 20\\.10\\.2026\\)`));

    await finishReconciliation(opened.runId, "2026-10-26T10:00:00.000Z");
    const text = renderText(await DepotDetailPage(props(id)));
    expect(text).toContain("Zuletzt abgeglichen am 20.10.2026");
    expect(text).not.toContain("Abgleich fortsetzen");
  });

  it("has no Depot-Aktionen menu on an archived Depot", async () => {
    const { id } = await depot();
    await archiveDepot(id);
    expect(renderHtml(await DepotDetailPage(props(id)))).not.toContain("Depot-Aktionen");
  });
});
