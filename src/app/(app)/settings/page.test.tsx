import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { archiveDepot, createDepot, recordTrade } from "@/modules/ledger";
import { ExportButton } from "../../_components/backup/ExportButton";
import { RestoreButton } from "../../_components/backup/RestoreButton";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { DepotGroups } from "../../_components/depots/DepotList";
import SettingsPage from "./page";

type Node = { props: { children?: unknown; "aria-labelledby"?: string } };

/** The element labelled by the "Datensicherung" heading (`aria-labelledby="settings-backup"`). */
function findBackupSection(node: unknown): Node | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findBackupSection(child);
      if (found) return found;
    }
    return undefined;
  }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as Node;
    if (element.props["aria-labelledby"] === "settings-backup") return element;
    return findBackupSection(element.props.children);
  }
  return undefined;
}

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

  it("links to the Parqet migration in its own section", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    const tree = await SettingsPage();
    expect(renderText(tree)).toContain("Parqet-Migration");
    const html = renderHtml(tree);
    expect(html).toMatch(/<a[^>]*href="\/settings\/parqet"[^>]*>Aus Parqet übernehmen/);
    expect(html).not.toMatch(/disabled[^>]*>Aus Parqet übernehmen/);
  });

  it("offers the JSON export button in the Datensicherung section", async () => {
    const tree = await SettingsPage();
    const section = findBackupSection(tree);
    expect(section).toBeDefined();
    expect(renderText(section as never)).toContain("Datensicherung");
    expect(findElement(section, ExportButton)).toBeDefined();
  });

  it("offers the restore button beside the export button in the Datensicherung section", async () => {
    const section = findBackupSection(await SettingsPage());
    expect(findElement(section, RestoreButton)).toBeDefined();
    expect(renderText(section as never)).toContain("wiederherstellen");
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

  it("offers a delete button on active and archived Depot cards", async () => {
    await createDepot({ name: "Aktiv", broker: "COMDIRECT" });
    const old = await createDepot({ name: "Alt", broker: "FINANZEN_ZERO" });
    if (!old.ok) throw new Error("setup failed");
    expect((await archiveDepot(old.depot.id)).ok).toBe(true);
    const html = renderHtml(await SettingsPage());
    expect(html).toMatch(/<button[^>]*aria-label="„Aktiv“ löschen"/);
    expect(html).toMatch(/<button[^>]*aria-label="„Alt“ löschen"/);
  });
});
