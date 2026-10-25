import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes, expectRedirect, findElement, RedirectError } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";
import { LoginForm } from "./LoginForm";
import LoginPage from "./page";

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

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const render = (params: Record<string, string>) => LoginPage({ searchParams: Promise.resolve(params) });

describe("LoginPage", () => {
  it("redirects a valid session to the sanitized next", async () => {
    fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
    expect(await expectRedirect(() => render({ next: "/depots?x=1" }))).toBe("/depots?x=1");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "/login"])(
    "redirects a valid session to / for the unsafe next %s",
    async (next) => {
      fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
      expect(await expectRedirect(() => render({ next }))).toBe("/");
    },
  );

  async function formProps(params: Record<string, string>) {
    const form = findElement(await render(params), LoginForm);
    expect(form).toBeDefined();
    return form!.props;
  }

  it("renders the form without a session, passing the sanitized next and expired: false", async () => {
    expect(await formProps({ next: "/depots?x=1" })).toEqual({ next: "/depots?x=1", expired: false });
    expect(await formProps({ next: "//evil.com" })).toEqual({ next: "/", expired: false });
    expect(await formProps({})).toEqual({ next: "/", expired: false });
  });

  it("passes expired: true for expired=1 with an expired session cookie", async () => {
    const old = await createSessionToken("tester", SECRET, new Date("2020-01-01T00:00:00Z"));
    fakes.current.state.incoming.set(SESSION_COOKIE, old);
    expect(await formProps({ next: "/", expired: "1" })).toEqual({ next: "/", expired: true });
  });
});
