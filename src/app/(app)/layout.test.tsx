import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes, expectRedirect, findElement, RedirectError } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";
import { AppShell } from "../_components/AppShell";
import { LogoProvider } from "../_components/securities/LogoContext";
import ProtectedLayout from "./layout";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const listLogoVersions = vi.hoisted(() => vi.fn());
const countOpenBatches = vi.hoisted(() => vi.fn());

vi.mock("@/modules/logos", () => ({ listLogoVersions }));
vi.mock("@/modules/import", () => ({ countOpenBatches }));

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
  listLogoVersions.mockReset();
  listLogoVersions.mockResolvedValue({ s1: "1761472800000" });
  countOpenBatches.mockReset();
  countOpenBatches.mockResolvedValue(2);
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

const render = () => ProtectedLayout({ children: "page" });

describe("(app) layout", () => {
  it("redirects to /login without a cookie, before reading logos or imports", async () => {
    expect(await expectRedirect(render)).toBe("/login");
    expect(listLogoVersions).not.toHaveBeenCalled();
    expect(countOpenBatches).not.toHaveBeenCalled();
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
    expect(findElement(tree, LogoProvider)?.props.versions).toEqual({ s1: "1761472800000" });
    expect(shell?.props.openImports).toBe(2);
  });

  it("shows no import count when the open batches cannot be counted, logging only the error name", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    countOpenBatches.mockRejectedValue(new TypeError("database locked"));
    fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
    const tree = await render();
    expect(findElement(tree, AppShell)?.props.openImports).toBe(0);
    expect(findElement(tree, AppShell)?.props.children).toBe("page");
    expect(error).toHaveBeenCalledWith("Import: counting open batches failed (TypeError)");
  });

  it("renders with initials only when the logo versions cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listLogoVersions.mockRejectedValue(new Error("database locked"));
    fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
    const tree = await render();
    expect(findElement(tree, LogoProvider)?.props.versions).toEqual({});
    expect(findElement(tree, AppShell)?.props.children).toBe("page");
  });
});
