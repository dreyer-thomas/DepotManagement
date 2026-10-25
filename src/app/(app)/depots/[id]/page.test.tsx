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
import { createDepot, recordTrade } from "@/modules/ledger";
import DepotDetailPage, { generateMetadata } from "./page";

beforeEach(async () => {
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

  it("shows name, Broker, Cash Account, the tabs and the empty Transactions state", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(text).toContain("Hauptdepot");
    expect(text).toContain("comdirect");
    expect(text).toContain("Cash-Konto 0,00\u00a0€");
    expect(text).toMatch(/Positionen .*Cash-Konto .*Buchungen/);
    expect(html).toMatch(selectedTab("Buchungen"));
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

  it.each([
    ["positions", "Positionen"],
    ["cash", "Cash-Konto"],
  ])("shows a placeholder on the %s tab", async (tab, label) => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, tab));
    const text = renderText(tree);
    expect(text).toContain("Dieser Bereich folgt in einer späteren Version.");
    expect(text).not.toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(selectedTab(label));
    expect(renderHtml(tree)).not.toMatch(selectedTab("Buchungen"));
    expect((renderHtml(tree).match(/<button[^>]*>Neue Buchung/g) ?? []).length).toBe(1);
  });

  it("falls back to the Buchungen tab for an unknown tab value", async () => {
    const { id } = await depot();
    const tree = await DepotDetailPage(props(id, "foo"));
    expect(renderText(tree)).toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(selectedTab("Buchungen"));
  });
});
