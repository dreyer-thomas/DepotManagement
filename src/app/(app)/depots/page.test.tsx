import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { prisma } from "@/db";
import { businessDate } from "@/core/dates";
import { archiveDepot, createDepot, recordTransaction, renameDepot } from "@/modules/ledger";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { DepotGroups } from "../../_components/depots/DepotList";
import DepotsPage from "./page";

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("Depots page", () => {
  it("shows the title, the create button and the empty text", async () => {
    const tree = await DepotsPage();
    expect(findElement(tree, CreateDepotButton)).toBeDefined();
    const text = renderText(tree);
    expect(text).toContain("Depots");
    expect(text).toContain("Noch kein Depot.");
  });

  it("lists Depots sorted by name, linking to the detail page, with the current name", async () => {
    const created = await createDepot({ name: "Comdirect Depot", broker: "COMDIRECT" });
    await createDepot({ name: "Bank", broker: "DEUTSCHE_BANK" });
    if (!created.ok) throw new Error("setup failed");
    await renameDepot(created.depot.id, { name: "Hauptdepot" });

    const tree = await DepotsPage();
    expect(findElement(tree, DepotGroups)?.props.depots).toEqual([
      expect.objectContaining({ name: "Bank" }),
      expect.objectContaining({ name: "Hauptdepot" }),
    ]);
    const text = renderText(tree);
    expect(text).toContain("Bank Deutsche Bank 0,00 € 0,00 € Wertpapiere 0,00 € Cash-Konto 0,00 € Positionen 0");
    expect(text).toContain("Hauptdepot comdirect 0,00 €");
    expect(text).not.toContain("Comdirect Depot");
    expect(text).not.toContain("Noch kein Depot.");
    expect(renderHtml(tree)).toContain(`href="/depots/${created.depot.id}"`);
  });

  it("groups archived Depots under a collapsed 'Archiviert' accordion", async () => {
    await createDepot({ name: "Aktiv", broker: "COMDIRECT" });
    const old = await createDepot({ name: "Alt", broker: "DEUTSCHE_BANK" });
    if (!old.ok) throw new Error("setup failed");
    expect((await archiveDepot(old.depot.id)).ok).toBe(true);

    const tree = await DepotsPage();
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(text).toMatch(/Aktiv comdirect 0,00\u00a0€ .*Archiviert \(1\) Alt Deutsche Bank Cash-Konto 0,00\u00a0€/);
    expect(html).toMatch(/aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Archiviert \(1\)/);
    expect(html).toContain(`href="/depots/${old.depot.id}"`);
    expect(html).not.toContain("umbenennen");
  });

  it("shows each active Depot's value, Period Gain/Loss, holdings split and returns for the stored Period", async () => {
    const created = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    if (!created.ok) throw new Error("setup failed");
    const date = businessDate(new Date());
    const deposit = await recordTransaction({ depotId: created.depot.id, type: "DEPOSIT", date, amount: "1000" });
    if (!deposit.ok) throw new Error("setup failed");

    const text = renderText(await DepotsPage());
    expect(text).toContain("Depots 1T 1W 1M YTD 1J 3J Max");
    expect(text).toMatch(/Hauptdepot comdirect 1\.000,00\u00a0€ 0,00\u00a0€ Wertpapiere 0,00\u00a0€ Cash-Konto 1\.000,00\u00a0€ Positionen 0 Dividenden · 1J 0,00\u00a0€ TTWROR · 1J/);
  });

  it("shows no 'Archiviert' group without archived Depots", async () => {
    await createDepot({ name: "Aktiv", broker: "COMDIRECT" });
    expect(renderText(await DepotsPage())).not.toContain("Archiviert");
  });
});
