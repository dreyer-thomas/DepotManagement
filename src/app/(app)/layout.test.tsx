import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes, expectRedirect, findElement, RedirectError } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";
import { AppShell } from "../_components/AppShell";
import ProtectedLayout from "./layout";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
  usePathname: () => "/",
}));

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

beforeEach(() => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const render = () => ProtectedLayout({ children: "page" });

describe("(app) layout", () => {
  it("redirects to /login without a cookie", async () => {
    expect(await expectRedirect(render)).toBe("/login");
  });

  it("redirects to /login with an invalid cookie", async () => {
    fakes.current.state.incoming.set(SESSION_COOKIE, "garbage");
    expect(await expectRedirect(render)).toBe("/login");
  });

  it("redirects to /login with a token signed by another secret", async () => {
    const token = await createSessionToken("tester", "another-secret-with-at-least-32-chars");
    fakes.current.state.incoming.set(SESSION_COOKIE, token);
    expect(await expectRedirect(render)).toBe("/login");
  });

  it("renders the page inside the app shell with a valid session", async () => {
    fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
    const tree = await render();
    const shell = findElement(tree, AppShell);
    expect(shell?.props.children).toBe("page");
  });
});
