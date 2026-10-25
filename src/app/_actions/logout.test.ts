import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes, expectRedirect, RedirectError } from "../../../test/helpers/next-mocks";
import { SESSION_COOKIE } from "@/modules/auth";
import { logout } from "./logout";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

beforeEach(() => {
  fakes.current = createRequestFakes();
});

describe("logout", () => {
  it("deletes the session cookie and redirects to /login", async () => {
    fakes.current.state.incoming.set(SESSION_COOKIE, "token");
    expect(await expectRedirect(() => logout())).toBe("/login");
    expect(fakes.current.state.deleted).toEqual([SESSION_COOKIE]);
  });
});
