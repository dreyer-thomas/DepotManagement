import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const refreshKeyFigures = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// The refresh never reaches a provider or the database here.
vi.mock("@/modules/classification", () => ({ refreshKeyFigures }));
const watchedSecurityIds = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock("@/modules/watchlist", () => ({ watchedSecurityIds }));

import { refreshKeyFiguresAction } from "./key-figures";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  refreshKeyFigures.mockReset();
});

describe("refreshKeyFiguresAction", () => {
  it("refreshes with the watched loader and revalidates the detail page and the watchlists", async () => {
    refreshKeyFigures.mockResolvedValue({ status: "updated" });
    expect(await refreshKeyFiguresAction("s1")).toEqual({ ok: true, status: "updated", message: "Kennzahlen aktualisiert." });
    expect(refreshKeyFigures).toHaveBeenCalledWith("s1", { watched: watchedSecurityIds });
    expect(revalidatePath).toHaveBeenCalledWith("/securities/s1");
    expect(revalidatePath).toHaveBeenCalledWith("/watchlists");
  });

  it("returns the German message of every other status without revalidating", async () => {
    refreshKeyFigures.mockResolvedValue({ status: "failed" });
    expect(await refreshKeyFiguresAction("s1")).toMatchObject({ ok: true, status: "failed", message: expect.stringMatching(/nicht geladen/) });
    refreshKeyFigures.mockResolvedValue({ status: "fresh" });
    expect(await refreshKeyFiguresAction("s1")).toMatchObject({ status: "fresh", message: expect.stringMatching(/von heute/) });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses without a session and fetches nothing", async () => {
    fakes.current.state.incoming.clear();
    expect(await refreshKeyFiguresAction("s1")).toEqual({ ok: false, reason: "unauthorized" });
    expect(refreshKeyFigures).not.toHaveBeenCalled();
  });
});
