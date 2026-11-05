import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const refreshPrices = vi.hoisted(() => vi.fn());
const refreshNews = vi.hoisted(() => vi.fn());
const watchedSecurityIds = vi.hoisted(() => vi.fn(async () => [] as string[]));
const watchlistPriceTargets = vi.hoisted(() => vi.fn(async () => new Map<string, string>()));

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// The refresh never reaches a provider or the database here.
vi.mock("@/modules/prices", () => ({ refreshPrices }));
vi.mock("@/modules/news", () => ({ refreshNews }));
vi.mock("@/modules/watchlist", () => ({ watchedSecurityIds, watchlistPriceTargets }));

import { refreshAllAction } from "./refresh";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  refreshPrices.mockReset();
  refreshNews.mockReset();
});

describe("refreshAllAction", () => {
  it("fetches all Prices, then all news (not only stale), revalidates every page and names the failures", async () => {
    const order: string[] = [];
    refreshPrices.mockImplementation(async () => {
      order.push("prices");
      return { updated: 2, failed: [{ securityId: "s1", name: "SAP SE", provider: "YAHOO", reason: "network" }] };
    });
    refreshNews.mockImplementation(async () => {
      order.push("news");
      return { updated: 1, failed: [{ securityId: "s2", name: "Beispiel AG" }] };
    });
    expect(await refreshAllAction()).toEqual({ ok: true, failedPrices: ["SAP SE"], failedNews: ["Beispiel AG"] });
    expect(order).toEqual(["prices", "news"]);
    expect(refreshPrices).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), { watched: watchlistPriceTargets });
    expect(refreshNews).toHaveBeenCalledWith({ watched: watchedSecurityIds });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("still reports fresh Prices when the news run fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refreshPrices.mockResolvedValue({ updated: 1, failed: [] });
    refreshNews.mockRejectedValue(new TypeError("boom"));
    expect(await refreshAllAction()).toEqual({ ok: true, failedPrices: [], failedNews: null });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses without a session and fetches nothing", async () => {
    fakes.current.state.incoming.clear();
    expect(await refreshAllAction()).toEqual({ ok: false, reason: "unauthorized" });
    expect(refreshPrices).not.toHaveBeenCalled();
    expect(refreshNews).not.toHaveBeenCalled();
  });
});
