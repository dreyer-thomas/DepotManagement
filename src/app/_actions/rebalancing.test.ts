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

import { prisma } from "@/db";
import { createDepot } from "@/modules/ledger";
import { getTargetAllocation } from "@/modules/rebalancing";
import { setTargetAllocationAction } from "./rebalancing";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let depotId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  await prisma.targetAllocation.deleteMany();
  await prisma.depot.deleteMany();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
});

afterEach(() => {
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

describe("setTargetAllocationAction", () => {
  it("stores the targets of the scope and revalidates Analysen", async () => {
    const result = await setTargetAllocationAction(
      null,
      form({ scope: "portfolio", "target-equityUsa": "60", "target-equityEurope": "25,5", "target-bonds": "14,5", "target-cash": "", threshold: "3" }),
    );
    expect(result).toMatchObject({ ok: true, allocation: { threshold: "3" } });
    expect(await getTargetAllocation("portfolio")).toMatchObject({ targets: { equityUsa: "60", equityEurope: "25.5", bonds: "14.5", cash: "0" }, threshold: "3" });
    expect(revalidatePath).toHaveBeenCalledWith("/analyses");

    expect(await setTargetAllocationAction(null, form({ scope: depotId, "target-cash": "100", threshold: "" }))).toMatchObject({ ok: true });
    expect(await getTargetAllocation(depotId)).toMatchObject({ targets: { cash: "100", equityUsa: "0" }, threshold: "2" });
    expect(await getTargetAllocation("portfolio")).toMatchObject({ targets: { equityUsa: "60" } });
  });

  it("returns the reason without writing", async () => {
    expect(await setTargetAllocationAction(null, form({ scope: "portfolio", "target-equityUsa": "99,5", threshold: "2" }))).toEqual({ ok: false, reason: "target-sum" });
    expect(await setTargetAllocationAction(null, form({ scope: "portfolio", "target-bonds": "1,234", "target-cash": "100" }))).toEqual({
      ok: false,
      reason: "target-invalid",
      segment: "bonds",
    });
    expect(await setTargetAllocationAction(null, form({ scope: "nope", "target-cash": "100" }))).toEqual({ ok: false, reason: "scope-not-found" });
    expect(await prisma.targetAllocation.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await setTargetAllocationAction(null, form({ scope: "portfolio", "target-cash": "100" }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await prisma.targetAllocation.count()).toBe(0);
  });
});
