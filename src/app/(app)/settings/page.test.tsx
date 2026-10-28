import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { runDatabaseBackup, stopBackupScheduler } from "@/modules/backup";
import { archiveDepot, createDepot, recordTrade } from "@/modules/ledger";
import { setTaxAllowances } from "@/modules/tax";
import { businessDate } from "@/core/dates";
import { ExportButton } from "../../_components/backup/ExportButton";
import { RestoreButton } from "../../_components/backup/RestoreButton";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { DepotGroups } from "../../_components/depots/DepotList";
import { ConnectedAppsEmpty } from "../../_components/connected-apps/ConnectedAppsEmpty";
import { ConnectedAppsList } from "../../_components/connected-apps/ConnectedAppsList";
import { AllowanceForm } from "../../_components/tax/AllowanceForm";
import SettingsPage from "./page";

type Node = { props: { children?: unknown; "aria-labelledby"?: string } };

/** The element labelled by the heading with id `labelledBy`. */
function findSection(node: unknown, labelledBy: string): Node | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSection(child, labelledBy);
      if (found) return found;
    }
    return undefined;
  }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as Node;
    if (element.props["aria-labelledby"] === labelledBy) return element;
    return findSection(element.props.children, labelledBy);
  }
  return undefined;
}

/** The element labelled by the "Datensicherung" heading (`aria-labelledby="settings-backup"`). */
const findBackupSection = (node: unknown) => findSection(node, "settings-backup");

let backupDir: string;

beforeEach(async () => {
  backupDir = mkdtempSync(join(tmpdir(), "depot-settings-backup-"));
  process.env.BACKUP_DIR = backupDir;
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
  await prisma.taxAllowance.deleteMany();
  await prisma.oAuthClient.deleteMany();
  delete process.env.APP_URL;
});

afterEach(() => {
  stopBackupScheduler();
  vi.restoreAllMocks();
  delete process.env.BACKUP_DIR;
  rmSync(backupDir, { recursive: true, force: true });
});

/** A dated DB backup file with the given mtime. */
function backupFile(name: string, iso: string): void {
  const path = join(backupDir, name);
  writeFileSync(path, "x");
  utimesSync(path, new Date(iso), new Date(iso));
}

/** Records a failed backup attempt: the DB file named by DATABASE_URL does not exist. */
async function failBackup(): Promise<void> {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const result = await runDatabaseBackup({
    env: { BACKUP_DIR: backupDir, DATABASE_URL: `file:${join(backupDir, "missing.db")}` },
    now: () => new Date("2026-10-26T08:00:00Z"),
  });
  expect(result.ok).toBe(false);
}

/** A registered client with a grant; `revokedAt` set means it was disconnected. */
async function seedGrant(
  name: string,
  createdAt: string,
  { lastUsedAt = null, revokedAt = null }: { lastUsedAt?: string | null; revokedAt?: string | null } = {},
) {
  const client = await prisma.oAuthClient.create({
    data: {
      clientId: `client-${name}`,
      clientName: name,
      redirectUris: JSON.stringify(["https://claude.ai/api/mcp/auth_callback", "http://localhost:33418/cb"]),
      grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
      tokenEndpointAuthMethod: "none",
      createdAt,
    },
  });
  return prisma.oAuthGrant.create({ data: { clientId: client.id, scope: "watchlist", createdAt, lastUsedAt, revokedAt } });
}

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

  it("shows the Steuern section with 'Noch kein Depot.' when there are no Depots", async () => {
    const tree = await SettingsPage();
    const section = findSection(tree, "settings-tax");
    expect(renderText(section as never)).toContain("Steuern");
    expect(renderText(section as never)).toContain("Noch kein Depot.");
    expect(findElement(tree, AllowanceForm)).toBeUndefined();
  });

  it("renders the allowance form between Parqet and Datensicherung with the stored amounts", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    expect(await setTaxAllowances("2026", { COMDIRECT: "801", DEUTSCHE_BANK: "300" })).toEqual({ ok: true });
    const tree = await SettingsPage();
    const form = findElement(tree, AllowanceForm);
    expect(form?.props.allowances).toEqual([
      { broker: "COMDIRECT", year: 2026, amount: "801" },
      { broker: "DEUTSCHE_BANK", year: 2026, amount: "300" },
    ]);
    const text = renderText(tree);
    expect(text.indexOf("Parqet-Migration")).toBeLessThan(text.indexOf("Steuern"));
    expect(text.indexOf("Steuern")).toBeLessThan(text.indexOf("Datensicherung"));
  });

  it("passes the first ledger year and today's year to the allowance form", async () => {
    const created = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    if (!created.ok) throw new Error("setup failed");
    const buy = await recordTrade({
      depotId: created.depot.id,
      type: "BUY",
      date: "2024-03-01",
      quantity: "1",
      price: "0",
      security: { new: { isin: "US0378331005", name: "Apple Inc.", assetType: "STOCK" } },
    });
    expect(buy.ok).toBe(true);
    const form = findElement(await SettingsPage(), AllowanceForm);
    expect(form?.props).toMatchObject({ firstYear: 2024, todayYear: Number(businessDate(new Date()).slice(0, 4)) });
  });

  it("offers the JSON export button in the Datensicherung section", async () => {
    const tree = await SettingsPage();
    const section = findBackupSection(tree);
    expect(section).toBeDefined();
    expect(renderText(section as never)).toContain("Datensicherung");
    expect(renderText(section as never)).toContain("Freistellungsaufträge, Teilfreistellungen und Zielallokationen");
    expect(findElement(section, ExportButton)).toBeDefined();
  });

  it("offers the restore button beside the export button in the Datensicherung section", async () => {
    const section = findBackupSection(await SettingsPage());
    expect(findElement(section, RestoreButton)).toBeDefined();
    expect(renderText(section as never)).toContain("wiederherstellen");
  });

  it("warns about a failed DB backup with the time of the last successful one", async () => {
    backupFile("depot-2026-10-25.sqlite", "2026-10-25T02:00:00Z");
    await failBackup();
    const section = findBackupSection(await SettingsPage());
    const html = renderHtml(section as never);
    expect(html).toMatch(/MuiAlert-colorWarning/);
    expect(renderText(section as never)).toContain(
      "Die letzte Datenbanksicherung ist fehlgeschlagen. Letzte erfolgreiche Sicherung: 25.10.2026, 03:00.",
    );
    expect(renderText(section as never)).not.toContain("Letzte Datenbanksicherung:");
  });

  it("warns about a failed DB backup when there was never a successful one", async () => {
    await failBackup();
    const text = renderText(findBackupSection(await SettingsPage()) as never);
    expect(text).toContain("Die letzte Datenbanksicherung ist fehlgeschlagen. Noch keine erfolgreiche Sicherung.");
  });

  it("shows the time of the last DB backup when no attempt failed", async () => {
    backupFile("depot-2026-10-25.sqlite", "2026-10-25T02:00:00Z");
    const section = findBackupSection(await SettingsPage());
    expect(renderText(section as never)).toContain("Letzte Datenbanksicherung: 25.10.2026, 03:00");
    expect(renderHtml(section as never)).not.toMatch(/MuiAlert/);
  });

  it("shows no DB backup line or warning without backups and failures", async () => {
    const section = findBackupSection(await SettingsPage());
    const text = renderText(section as never);
    expect(text).not.toContain("Datenbanksicherung");
    expect(renderHtml(section as never)).not.toMatch(/MuiAlert/);
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
  it("lists active connected apps newest first after Datensicherung, without revoked ones", async () => {
    await seedGrant("Claude", "2026-10-20T08:00:00.000Z", { lastUsedAt: "2026-10-28T09:30:00.000Z" });
    await seedGrant("Claude Code", "2026-10-25T08:00:00.000Z");
    await seedGrant("Alt", "2026-10-26T08:00:00.000Z", { revokedAt: "2026-10-27T08:00:00.000Z" });
    const tree = await SettingsPage();
    const section = findSection(tree, "settings-connected-apps");
    const list = findElement(section, ConnectedAppsList);
    expect((list?.props.apps as { clientName: string }[]).map((app) => app.clientName)).toEqual(["Claude Code", "Claude"]);
    const text = renderText(section as never);
    expect(text).toContain("Verbundene Apps");
    expect(text).toContain("Claude Code");
    expect(text).toContain("claude.ai, localhost:33418");
    expect(text).toContain("Watchlists lesen und ändern");
    expect(text).toContain("Verbunden seit 20.10.2026, 10:00");
    expect(text).toContain("Zuletzt verwendet 28.10.2026, 10:30");
    expect(text).toContain("Zuletzt verwendet: noch nie");
    expect(text).toContain("Alle trennen");
    expect(text).not.toContain("Alt");
    const all = renderText(tree);
    expect(all.indexOf("Datensicherung")).toBeLessThan(all.indexOf("Verbundene Apps"));
  });

  it("explains how to connect Claude with APP_URL when no app is connected", async () => {
    process.env.APP_URL = "https://depot.example.com/";
    await seedGrant("Alt", "2026-10-26T08:00:00.000Z", { revokedAt: "2026-10-27T08:00:00.000Z" });
    const section = findSection(await SettingsPage(), "settings-connected-apps");
    const empty = findElement(section, ConnectedAppsList)?.props.empty as { type: unknown; props: { issuer: string | null } };
    expect(empty.type).toBe(ConnectedAppsEmpty);
    expect(empty.props.issuer).toBe("https://depot.example.com");
    const text = renderText(section as never);
    expect(text).toContain("Noch keine App verbunden.");
    expect(text).toContain("https://depot.example.com/api/mcp");
    expect(text).toContain("claude mcp add --transport http depotmanagement https://depot.example.com/api/mcp");
    expect(text).toContain("„Erlauben“");
    expect(text).not.toContain("APP_URL");
    expect(text).not.toContain("Alle trennen");
  });

  it("asks to set APP_URL first in the empty state when it is unset or invalid", async () => {
    for (const value of [undefined, "not a url"]) {
      if (value === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = value;
      const text = renderText(findSection(await SettingsPage(), "settings-connected-apps") as never);
      expect(text).toContain("Setze zuerst die Umgebungsvariable APP_URL");
      expect(text).toContain("claude mcp add --transport http depotmanagement <APP_URL>/api/mcp");
    }
  });
});
