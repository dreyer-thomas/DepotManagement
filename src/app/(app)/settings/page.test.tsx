import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { archiveDepot, createDepot, recordTrade } from "@/modules/ledger";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { DepotGroups } from "../../_components/depots/DepotList";
import SettingsPage from "./page";

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("Settings page", () => {
  it("shows the Depots section with the create button when empty", async () => {
    const tree = await SettingsPage();
    expect(findElement(tree, CreateDepotButton)).toBeDefined();
    const text = renderText(tree);
    expect(text).toContain("Einstellungen");
    expect(text).toContain("Depots");
    expect(text).toContain("Noch kein Depot.");
  });

  it("lists Depots with a rename button each", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    const tree = await SettingsPage();
    expect(findElement(tree, DepotGroups)?.props.settings).toBe(true);
    expect(renderText(tree)).toContain("Hauptdepot comdirect Cash-Konto 0,00 €");
    expect(renderHtml(tree)).toContain('aria-label="&quot;Hauptdepot&quot; umbenennen"');
  });

  it("offers an enabled archive button for a flat Depot", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    const html = renderHtml(await SettingsPage());
    const button = html.match(/<button[^>]*aria-label="„Hauptdepot“ archivieren"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toMatch(/disabled/);
    expect(renderText(await SettingsPage())).not.toContain("Depot hat noch Positionen oder Guthaben.");
  });

  it("disables the archive button and shows the reason for a Depot with a Position", async () => {
    const created = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    if (!created.ok) throw new Error("setup failed");
    const buy = await recordTrade({
      depotId: created.depot.id,
      type: "BUY",
      date: "2026-01-10",
      quantity: "1",
      price: "0",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    expect(buy.ok).toBe(true);
    const tree = await SettingsPage();
    const html = renderHtml(tree);
    const button = html.match(/<button[^>]*aria-label="„Hauptdepot“ archivieren"[^>]*>/)?.[0];
    expect(button).toMatch(/disabled/);
    expect(button).toContain(`aria-describedby="depot-archive-blocked-${created.depot.id}"`);
    expect(renderText(tree)).toContain("Depot hat noch Positionen oder Guthaben.");
  });

  it("lists archived Depots under 'Archiviert (1)' with a Reaktivieren button and no rename", async () => {
    await createDepot({ name: "Aktiv", broker: "COMDIRECT" });
    const old = await createDepot({ name: "Alt", broker: "FINANZEN_ZERO" });
    if (!old.ok) throw new Error("setup failed");
    expect((await archiveDepot(old.depot.id)).ok).toBe(true);
    const tree = await SettingsPage();
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(text).toMatch(/Archiviert \(1\) Alt finanzen\.net zero Cash-Konto 0,00\u00a0€ Reaktivieren/);
    expect(html).toContain('aria-label="&quot;Aktiv&quot; umbenennen"');
    expect(html).not.toContain('aria-label="&quot;Alt&quot; umbenennen"');
    expect(html).not.toContain("„Alt“ archivieren");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Reaktivieren/);
    expect(html).toMatch(new RegExp(`<input[^>]*name="id"[^>]*value="${old.depot.id}"`));
  });
});
