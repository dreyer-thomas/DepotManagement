import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const refreshNews = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// The refresh never reaches a provider or the database here.
vi.mock("@/modules/news", () => ({ refreshNews }));

import { refreshNewsAction } from "./news";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  refreshNews.mockReset();
});

describe("refreshNewsAction", () => {
  it("refreshes only stale Securities, revalidates the news page and returns the result", async () => {
    refreshNews.mockResolvedValue({ updated: 2, failed: [{ securityId: "s1", name: "SAP SE" }] });
    expect(await refreshNewsAction()).toEqual({ ok: true, updated: 2, failed: [{ securityId: "s1", name: "SAP SE" }] });
    expect(refreshNews).toHaveBeenCalledWith({ onlyStale: true });
    expect(revalidatePath).toHaveBeenCalledWith("/news");
  });

  it("refuses without a session and fetches nothing", async () => {
    fakes.current.state.incoming.clear();
    expect(await refreshNewsAction()).toEqual({ ok: false, reason: "unauthorized" });
    expect(refreshNews).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
