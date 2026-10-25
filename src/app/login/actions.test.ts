import bcrypt from "bcrypt";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes, expectRedirect, RedirectError } from "../../../test/helpers/next-mocks";
import { SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from "@/modules/auth";
import { login, type LoginState } from "./actions";

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
const savedEnv = { ...process.env };
let hash: string;

beforeAll(async () => {
  hash = await bcrypt.hash("test-pass", 4); // synthetic, low cost
});

beforeEach(() => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = hash;
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const initial: LoginState = { failed: false, username: "", attempt: 0 };

function form(username: string, password: string, next?: string) {
  const data = new FormData();
  data.set("username", username);
  data.set("password", password);
  if (next !== undefined) data.set("next", next);
  return data;
}

describe("login action", () => {
  it.each([
    ["no x-forwarded-proto", undefined, false],
    ["http", "http", false],
    ["https", "https", true],
  ])("sets the session cookie (%s) and redirects to next", async (_label, proto, secure) => {
    if (proto) fakes.current.state.headers.set("x-forwarded-proto", proto);
    const url = await expectRedirect(() => login(initial, form("tester", "test-pass", "/depots")));
    expect(url).toBe("/depots");
    const { set } = fakes.current.state;
    expect(set).toHaveLength(1);
    expect(set[0].name).toBe(SESSION_COOKIE);
    expect(set[0].options).toEqual(sessionCookieOptions(secure));
    expect(await verifySessionToken(set[0].value, { username: "tester", secret: SECRET })).toEqual({
      username: "tester",
    });
  });

  it("answers a wrong username and a wrong password identically, without a cookie", async () => {
    const wrongUser = await login(initial, form("someone", "test-pass", "/depots"));
    const wrongPassword = await login(initial, form("tester", "wrong", "/depots"));
    expect(wrongUser).toEqual({ failed: true, username: "someone", attempt: 1 });
    expect(wrongPassword).toEqual({ failed: true, username: "tester", attempt: 1 });
    // Same shape apart from echoing the submitted username: nothing says which field was wrong.
    expect({ ...wrongUser, username: "" }).toEqual({ ...wrongPassword, username: "" });
    expect(fakes.current.state.set).toEqual([]);
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "/login"])(
    "redirects to / for the unsafe next %s",
    async (next) => {
      expect(await expectRedirect(() => login(initial, form("tester", "test-pass", next)))).toBe("/");
    },
  );

  it("echoes at most 256 characters of an over-long username", async () => {
    const result = await login(initial, form("u".repeat(10_000), "test-pass", "/"));
    expect(result).toEqual({ failed: true, username: "u".repeat(256), attempt: 1 });
  });

  it("redirects to / without next", async () => {
    expect(await expectRedirect(() => login(initial, form("tester", "test-pass")))).toBe("/");
  });

  it("fails without a cookie when the auth configuration is invalid", async () => {
    process.env.SESSION_SECRET = "";
    expect((await login(initial, form("tester", "test-pass", "/"))).failed).toBe(true);
    expect(fakes.current.state.set).toEqual([]);
  });
});
