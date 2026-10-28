import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});
const cookieValues = vi.hoisted(() => new Map<string, string>());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieValues.has(name) ? { name, value: cookieValues.get(name)! } : undefined) }),
}));

import { prisma } from "@/db";
import { businessDate } from "@/core/dates";
import { ensureSecurity } from "@/modules/ledger";
import { addWatchlistEntry, createWatchlist } from "@/modules/watchlist";
import { CreateWatchlistButton, DeleteWatchlistButton, RenameWatchlistButton } from "@/app/_components/watchlists/WatchlistDialogs";
import { AddWatchlistEntryButton } from "@/app/_components/watchlists/WatchlistEntryDialog";
import { WatchlistTable } from "@/app/_components/watchlists/WatchlistTable";
import { WatchlistTabs } from "@/app/_components/watchlists/WatchlistTabs";
import WatchlistsPage from "./page";

beforeEach(async () => {
  cookieValues.clear();
  await prisma.watchlistEntry.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.securityKeyFigures.deleteMany();
  await prisma.security.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

async function list(name: string) {
  const result = await createWatchlist({ name });
  if (!result.ok) throw new Error("setup failed");
  return result.watchlist.id;
}

const page = (listParam?: string) => WatchlistsPage({ searchParams: Promise.resolve(listParam ? { list: listParam } : {}) });

describe("Watchlists page", () => {
  it("offers 'Watchlist anlegen' without any list", async () => {
    const tree = await page();
    expect(findElement(tree, CreateWatchlistButton)).toBeDefined();
    expect(findElement(tree, WatchlistTabs)).toBeUndefined();
    expect(renderText(tree)).toContain("Noch keine Watchlist.");
  });

  it("shows the lists in creation order and opens the first by default", async () => {
    const a = await list("A");
    const b = await list("B");
    const tree = await page();
    expect(findElement(tree, WatchlistTabs)?.props).toMatchObject({
      lists: [
        { id: a, name: "A" },
        { id: b, name: "B" },
      ],
      selectedId: a,
    });
    expect(findElement(tree, AddWatchlistEntryButton)?.props.watchlistId).toBe(a);
    expect(findElement(tree, RenameWatchlistButton)?.props.watchlist).toMatchObject({ id: a, name: "A" });
    expect(findElement(tree, DeleteWatchlistButton)?.props.watchlist).toEqual({ id: a, name: "A", entryCount: 0 });
  });

  it("opens ?list=, else the remembered list (cookie), ignoring unknown ids", async () => {
    const a = await list("A");
    const b = await list("B");
    expect(findElement(await page(b), WatchlistTabs)?.props.selectedId).toBe(b);
    cookieValues.set("dm_watchlist", b);
    expect(findElement(await page(), WatchlistTabs)?.props.selectedId).toBe(b);
    expect(findElement(await page(a), WatchlistTabs)?.props.selectedId).toBe(a);
    cookieValues.set("dm_watchlist", "gone");
    expect(findElement(await page("gone"), WatchlistTabs)?.props.selectedId).toBe(a);
  });

  it("passes the selected list's entries with figures, all lists and the Securities", async () => {
    const a = await list("A");
    const sap = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
    if (!sap.ok) throw new Error("setup failed");
    const today = businessDate(new Date());
    const added = await addWatchlistEntry({ watchlistId: a, security: { id: sap.security.id }, note: "Idee" }, today);
    expect(added.ok).toBe(true);
    const tree = await page();
    const table = findElement(tree, WatchlistTable);
    expect(table?.props.entries).toEqual([
      expect.objectContaining({ security: expect.objectContaining({ name: "SAP SE" }), note: "Idee", dateAdded: today, price: null, held: false }),
    ]);
    expect(table?.props.lists).toEqual([{ id: a, name: "A" }]);
    expect(findElement(tree, AddWatchlistEntryButton)?.props.securities).toEqual([expect.objectContaining({ id: sap.security.id })]);
    expect(findElement(tree, DeleteWatchlistButton)?.props.watchlist).toMatchObject({ entryCount: 1 });
  });

  it("passes the key figures of the entries' snapshots and the remembered columns (unknown keys dropped)", async () => {
    const a = await list("A");
    const sap = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
    if (!sap.ok) throw new Error("setup failed");
    const today = businessDate(new Date());
    expect((await addWatchlistEntry({ watchlistId: a, security: { id: sap.security.id } }, today)).ok).toBe(true);
    await prisma.securityKeyFigures.create({
      data: {
        securityId: sap.security.id,
        symbol: "SAP.DE", kind: "stock",
        figures: JSON.stringify({ trailingPE: "30.4321", dividendYield: "0.0118" }),
        fetchedAt: new Date().toISOString(),
      },
    });
    cookieValues.set("dm_watchlist_columns", "distanceToHigh%2Cbogus%2Ckgv");
    const table = findElement(await page(), WatchlistTable);
    expect(table?.props.keyFigures).toEqual({ [sap.security.id]: { trailingPE: "30.4321", dividendYield: "0.0118" } });
    expect(table?.props.initialColumns).toEqual(["kgv", "distanceToHigh"]);
    expect((table?.props.entries as { fiftyTwoWeek: unknown }[])[0].fiftyTwoWeek).toEqual({ high: null, low: null, distanceToHigh: null, performance: null });
  });

  it("shows no key-figure column without the cookie", async () => {
    await list("A");
    expect(findElement(await page(), WatchlistTable)?.props.initialColumns).toEqual([]);
  });
});
