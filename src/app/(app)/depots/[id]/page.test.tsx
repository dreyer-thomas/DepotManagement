import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
}));

import { prisma } from "@/db";
import { archiveDepot, createDepot, recordIsinChange, recordSplit, recordTrade, recordTransaction, type RecordTransactionInput, updateTransaction } from "@/modules/ledger";
import DepotDetailPage, { generateMetadata } from "./page";

beforeEach(async () => {
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
    expect(text).toContain("Hauptdepot");
    expect(text).toContain("comdirect");
    expect(text).toContain("Cash-Konto 0,00\u00a0€");
    expect(text).toMatch(/Positionen .*Cash-Konto .*Buchungen/);
    expect(html).toMatch(selectedTab("Positionen"));
    for (const tab of ["positions", "cash", "transactions"]) {
      expect(html).toContain(`href="/depots/${id}?tab=${tab}"`);
    }
    expect(text).toContain("Noch keine Buchungen.");
    const buttons = html.match(/<button[^>]*>Neue Buchung/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toMatch(/disabled/);
    expect(await generateMetadata(props(id))).toEqual({ title: "Hauptdepot" });
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
    expect((html.match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
  });

  it("shows the empty state with one Neue Buchung button on the Buchungen tab", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "transactions"));
    expect(renderText(tree)).toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(selectedTab("Buchungen"));
    expect((renderHtml(tree).match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
  });

  it("shows the empty state with one Neue Buchung button on the Cash-Konto tab", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "cash"));
    const text = renderText(tree);
    expect(text).toContain("Noch keine Buchungen.");
    expect(text).not.toContain("Dieser Bereich folgt");
    expect(renderHtml(tree)).toMatch(selectedTab("Cash-Konto"));
    expect((renderHtml(tree).match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
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
    expect((html.match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
  });

  it("pins the Cash row with the current balance last in Positionen", async () => {
    const { id } = await depot();
    await bookMatrix(id);
    const text = renderText(await DepotDetailPage(props(id)));
    expect(text).toContain("Cash-Konto 731,10\u00a0€");
    expect(text).toMatch(/AI Apple Inc\. 10 1\.005,00\u00a0€ .*Cash-Konto 731,10\u00a0€ Sortieren nach/);
    expect(text).toMatch(/Apple Inc\. 10 Stück 1\.000,00\u00a0€ .*Cash-Konto 731,10\u00a0€$/);
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
      "AI Apple Inc. 3 361,20\u00a0€ 120,40\u00a0€ 130,00\u00a0€ 390,00\u00a0€ +28,80\u00a0€ · +7,97\u00a0%",
    );
    expect(text).toContain("AI Apple Inc. 3 Stück 390,00\u00a0€ +28,80\u00a0€ · +7,97\u00a0%");
    expect(text).toContain("Sortieren nach");
    expect(html).toContain("<table");
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*>(?:(?!<\/th>).)*Wert/);
    expect((html.match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
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
    expect(renderText(await DepotDetailPage(props(id)))).toContain("110,00\u00a0€ 1.100,00\u00a0€ +100,00\u00a0€");
    await price("2026-01-12", "MANUAL", "115");
    expect(renderText(await DepotDetailPage(props(id)))).toContain("115,00\u00a0€ 1.150,00\u00a0€ +150,00\u00a0€");
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
    expect(text).toMatch(/SAP SE 2 Stück 600,00\u00a0€.*Apple Inc\. 1 Stück 50,00\u00a0€/);
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
    expect((renderHtml(tree).match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
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
    expect(positions).toContain("AI Apple Inc. 10 905,00\u00a0€ 90,50\u00a0€ 90,00\u00a0€ 900,00\u00a0€");
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

    for (const tab of ["positions", "cash", "transactions"]) {
      const tree = await DepotDetailPage(props(id, tab));
      const text = renderText(tree);
      const html = renderHtml(tree);
      expect(text).toMatch(/Hauptdepot comdirect Archiviert Cash-Konto/);
      expect(text).toMatch(/Archiviertes Depot – nur lesbar\. Reaktivieren unter Einstellungen ?\./);
      expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>Einstellungen<\/a>/);
      expect(html).not.toMatch(/<button[^>]*>Neue Buchung/);
      expect(html).not.toContain("bearbeiten");
    }
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
    expect(renderHtml(tree)).not.toMatch(/<button[^>]*>Neue Buchung/);
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
    expect(renderText(positions)).toContain("AI Apple Inc. 40 4.000,00\u00a0€ 100,00\u00a0€ 100,00\u00a0€ 4.000,00\u00a0€");
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
    expect(text).toContain("NA Neu AG 5 1.000,00\u00a0€ 200,00\u00a0€ 200,00\u00a0€ 1.000,00\u00a0€");
    expect(text).not.toContain("Alt AG");
    expect(renderHtml(positions).match(/aria-label="Aktionen für Neu AG"/g)).toHaveLength(2);

    const transactions = renderText(await DepotDetailPage(props(id, "transactions")));
    expect(transactions).toContain("Alt AG");
    expect(transactions).not.toContain("Neu AG");
  });
});
