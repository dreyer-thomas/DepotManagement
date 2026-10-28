import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const schedulePriceBackfill = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// The backfill itself is covered by price-refresh tests; here only whether it is scheduled.
vi.mock("./price-refresh", () => ({ schedulePriceBackfill }));

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { WATCHLIST_FIELDS } from "@/app/_components/watchlists/form-fields";
import {
  addWatchlistEntryAction,
  createWatchlistAction,
  deleteWatchlistAction,
  removeWatchlistEntryAction,
  renameWatchlistAction,
  updateWatchlistEntryAction,
} from "./watchlists";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  schedulePriceBackfill.mockClear();
  vi.useFakeTimers({ now: new Date("2026-10-28T10:00:00.000Z"), toFake: ["Date"] });
  await prisma.watchlistEntry.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.security.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function createList(name: string) {
  const result = await createWatchlistAction(null, form({ [WATCHLIST_FIELDS.name]: name }));
  if (!result?.ok) throw new Error("setup failed");
  return result.watchlist.id;
}

async function sap() {
  const result = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
  if (!result.ok) throw new Error("setup failed");
  return result.security.id;
}

describe("watchlist actions without a session", () => {
  it("refuse every write", async () => {
    fakes.current.state.incoming.clear();
    const unauthorized = { ok: false, reason: "unauthorized" };
    expect(await createWatchlistAction(null, form({ name: "Ideen" }))).toEqual(unauthorized);
    expect(await renameWatchlistAction(null, form({ watchlistId: "x", name: "Ideen" }))).toEqual(unauthorized);
    expect(await deleteWatchlistAction(null, form({ watchlistId: "x" }))).toEqual(unauthorized);
    expect(await addWatchlistEntryAction(null, form({ watchlistId: "x", securityId: "s" }))).toEqual(unauthorized);
    expect(await updateWatchlistEntryAction(null, form({ entryId: "e" }))).toEqual(unauthorized);
    expect(await removeWatchlistEntryAction("e")).toEqual(unauthorized);
    expect(await prisma.watchlist.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("list actions", () => {
  it("create, rename and delete a list, revalidating /watchlists", async () => {
    const id = await createList(" Ideen ");
    expect(revalidatePath).toHaveBeenCalledWith("/watchlists");
    expect(await createWatchlistAction(null, form({ name: "ideen" }))).toEqual({ ok: false, reason: "name-taken" });

    expect(await renameWatchlistAction(null, form({ watchlistId: id, name: "Dividenden" }))).toMatchObject({
      ok: true,
      watchlist: { name: "Dividenden" },
    });
    expect(await deleteWatchlistAction(null, form({ watchlistId: id }))).toEqual({ ok: true, deleted: { entries: 0 } });
    expect(await prisma.watchlist.count()).toBe(0);
  });
});

describe("entry actions", () => {
  it("adds an existing Security and schedules a backfill", async () => {
    const list = await createList("Ideen");
    const security = await sap();
    const result = await addWatchlistEntryAction(
      null,
      form({ watchlistId: list, securityId: security, note: "Idee", dateAdded: "2026-10-01" }),
    );
    expect(result).toMatchObject({ ok: true, entry: { securityId: security, note: "Idee", dateAdded: "2026-10-01", source: "APP" } });
    expect(schedulePriceBackfill).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/watchlists");

    expect(await addWatchlistEntryAction(null, form({ watchlistId: list, securityId: security }))).toEqual({
      ok: false,
      reason: "already-on-list",
    });
    expect(schedulePriceBackfill).toHaveBeenCalledTimes(1);
  });

  it("creates a new Security from the form fields; an empty date means today", async () => {
    const list = await createList("Ideen");
    const result = await addWatchlistEntryAction(
      null,
      form({ watchlistId: list, newSecurity: "1", securityIdentifier: "btc", securityName: "Bitcoin", assetType: "CRYPTO", dateAdded: "" }),
    );
    expect(result).toMatchObject({ ok: true, entry: { dateAdded: "2026-10-28" }, security: { cryptoSymbol: "BTC", assetType: "CRYPTO" } });
    expect(
      await addWatchlistEntryAction(
        null,
        form({ watchlistId: list, newSecurity: "1", securityIdentifier: "DE000BAD0000", securityName: "X", assetType: "STOCK" }),
      ),
    ).toEqual({ ok: false, reason: "isin-invalid" });
  });

  it("edits, moves and removes an entry; a backfill is scheduled only when the date moves earlier", async () => {
    const a = await createList("A");
    const b = await createList("B");
    const security = await sap();
    const added = await addWatchlistEntryAction(null, form({ watchlistId: a, securityId: security, dateAdded: "2026-10-20" }));
    if (!added?.ok) throw new Error("setup failed");
    schedulePriceBackfill.mockClear();
    const entryId = added.entry.id;

    expect(await updateWatchlistEntryAction(null, form({ entryId, note: "neu", dateAdded: "2026-10-25", watchlistId: a }))).toMatchObject({
      ok: true,
      entry: { note: "neu", dateAdded: "2026-10-25" },
    });
    expect(schedulePriceBackfill).not.toHaveBeenCalled();
    expect(await updateWatchlistEntryAction(null, form({ entryId, note: "neu", dateAdded: "2026-09-01", watchlistId: b }))).toMatchObject({
      ok: true,
      entry: { watchlistId: b, dateAdded: "2026-09-01" },
    });
    expect(schedulePriceBackfill).toHaveBeenCalledTimes(1);
    expect(await updateWatchlistEntryAction(null, form({ entryId, note: "", dateAdded: "2026-10-29" }))).toEqual({
      ok: false,
      reason: "date-invalid",
    });

    expect(await removeWatchlistEntryAction(entryId)).toEqual({ ok: true });
    expect(await removeWatchlistEntryAction(entryId)).toEqual({ ok: false, reason: "not-found" });
    expect(await prisma.security.count()).toBe(1);
  });
});
