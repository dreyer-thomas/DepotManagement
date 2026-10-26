import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));

import { setPeriodAction } from "./period";
import { PERIOD_COOKIE, readPeriod } from "./period-cookie";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31_536_000, secure: false };

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
});

describe("setPeriodAction", () => {
  it("stores a preset in the Period cookie", async () => {
    expect(await setPeriodAction("3J")).toEqual({ ok: true });
    expect(fakes.current.state.set).toEqual([{ name: PERIOD_COOKIE, value: "3J", options: OPTIONS }]);
  });

  it("stores a custom range and marks the cookie secure behind https", async () => {
    fakes.current.state.headers.set("x-forwarded-proto", "https");
    expect(await setPeriodAction("custom:2026-01-01:2026-06-30")).toEqual({ ok: true });
    expect(fakes.current.state.set).toEqual([
      { name: PERIOD_COOKIE, value: "custom:2026-01-01:2026-06-30", options: { ...OPTIONS, secure: true } },
    ]);
  });

  it.each(["custom:2026-13-01:x", "custom:2026-06-30:2026-01-01", "custom:2026-01-01:2999-01-01", "1Y", 7])(
    "refuses %j without saving",
    async (text) => {
      expect(await setPeriodAction(text)).toEqual({ ok: false, reason: "invalid" });
      expect(fakes.current.state.set).toEqual([]);
    },
  );

  it("refuses without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await setPeriodAction("1M")).toEqual({ ok: false, reason: "unauthorized" });
    expect(fakes.current.state.set).toEqual([]);
  });
});

describe("readPeriod", () => {
  it("reads the stored Period and falls back to 1J when missing or invalid", async () => {
    expect(await readPeriod("2026-10-26")).toEqual({ kind: "preset", preset: "1J" });
    fakes.current.state.incoming.set(PERIOD_COOKIE, "custom:2026-01-01:2026-06-30");
    expect(await readPeriod("2026-10-26")).toEqual({ kind: "custom", from: "2026-01-01", to: "2026-06-30" });
    fakes.current.state.incoming.set(PERIOD_COOKIE, "custom:2026-01-01:2026-12-31");
    expect(await readPeriod("2026-10-26")).toEqual({ kind: "preset", preset: "1J" });
    fakes.current.state.incoming.set(PERIOD_COOKIE, "MAX");
    expect(await readPeriod("2026-10-26")).toEqual({ kind: "preset", preset: "MAX" });
  });
});
