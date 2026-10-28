import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
const scheduleClassificationRefresh = vi.hoisted(() => vi.fn());
vi.mock("./classification-refresh", () => ({ scheduleClassificationRefresh }));

import { prisma } from "@/db";
import { createExport, RESTORE_MAX_FILE_BYTES, serializeExport } from "@/modules/backup";
import { restoreAction } from "./backup";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let scratch: string;

const EXPORT = JSON.stringify({
  schemaVersion: 1,
  depots: [{ id: "d1", name: "Hauptdepot", broker: "COMDIRECT", archived: false }],
  securities: [],
  providerMappings: [],
  transactions: [],
  corporateActions: [],
  reconciliationRuns: [],
  prices: [],
  logos: [],
});

beforeEach(async () => {
  fakes.current = createRequestFakes();
  scratch = mkdtempSync(join(tmpdir(), "depot-restore-action-"));
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = join(scratch, "data");
  process.env.BACKUP_DIR = join(scratch, "backups");
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  scheduleClassificationRefresh.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await prisma.transaction.deleteMany();
  await prisma.depot.deleteMany();
  await prisma.depot.create({ data: { id: "old", name: "Altdepot", broker: "DEUTSCHE_BANK" } });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  rmSync(scratch, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function form(file?: File) {
  const data = new FormData();
  if (file) data.set("file", file);
  return data;
}

const json = (text: string, name = "export.json") => new File([text], name, { type: "application/json" });
const depots = async () => (await prisma.depot.findMany({ select: { id: true } })).map((depot) => depot.id);
const backups = () => {
  try {
    return readdirSync(join(scratch, "backups"));
  } catch {
    return [];
  }
};

describe("restoreAction", () => {
  it("replaces the data, names the automatic export and revalidates", async () => {
    const result = await restoreAction(null, form(json(EXPORT)));
    expect(result).toEqual({ ok: true, backupFileName: expect.stringMatching(/^depotmanagement-export-\d{8}-\d{6}\.json$/) });
    expect(await depots()).toEqual(["d1"]);
    expect(backups()).toEqual([(result as { backupFileName: string }).backupFileName]);
    // A version-1 export restores; the next export is version 6 without classifications, tax settings, targets or watchlists.
    expect(serializeExport(await createExport())).toBe(
      JSON.stringify(
        { ...JSON.parse(EXPORT), schemaVersion: 6, classifications: [], taxAllowances: [], teilfreistellungOverrides: [], targetAllocations: [], watchlists: [] },
        null,
        2,
      ),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(scheduleClassificationRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no file", undefined, "file-missing"],
    ["an empty unnamed file", new File([], ""), "file-missing"],
    ["a file over 50 MB", json(" ".repeat(RESTORE_MAX_FILE_BYTES + 1)), "file-too-large"],
  ])("returns %s as %s without changing anything", async (_label, file, reason) => {
    expect(await restoreAction(null, form(file))).toEqual({ ok: false, reason });
    expect(await depots()).toEqual(["old"]);
    expect(backups()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes a validation failure through without revalidating", async () => {
    expect(await restoreAction(null, form(json("abc")))).toEqual({ ok: false, reason: "not-json" });
    expect(scheduleClassificationRefresh).not.toHaveBeenCalled();
    expect(await depots()).toEqual(["old"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reads and changes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    const file = json(EXPORT);
    const text = vi.spyOn(file, "text");
    expect(await restoreAction(null, form(file))).toEqual({ ok: false, reason: "unauthorized" });
    expect(text).not.toHaveBeenCalled();
    expect(await depots()).toEqual(["old"]);
    expect(backups()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
