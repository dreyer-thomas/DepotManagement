import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes, expectRedirect, findElement, RedirectError } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

import { prisma } from "@/db";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";
import { registerClient } from "@/modules/mcp";
import LoginPage from "../../login/page";
import { LoginForm } from "../../login/LoginForm";
import { decideAuthorization } from "./actions";
import { ConsentForm } from "./ConsentForm";
import AuthorizePage from "./page";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const APP_URL = "https://depot.example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const savedEnv = { ...process.env };
let clientId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_URL = APP_URL;
  await prisma.oAuthToken.deleteMany();
  await prisma.oAuthGrant.deleteMany();
  await prisma.oAuthClient.deleteMany();
  const registered = await registerClient({ client_name: "Claude", redirect_uris: [REDIRECT] });
  if (!registered.ok) throw new Error("setup failed");
  clientId = registered.body.client_id as string;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function params(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const all: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "xyz",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: "watchlist",
    resource: `${APP_URL}/api/mcp`,
    ...extra,
  };
  return Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

const render = (search: Record<string, string>) => AuthorizePage({ searchParams: Promise.resolve(search) });

async function signIn() {
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
}

function formData(values: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

describe("authorize page", () => {
  it("sends a visitor without a session to the login, which returns to the consent page", async () => {
    const search = params();
    const target = await expectRedirect(() => render(search));
    const next = `/oauth/authorize?${new URLSearchParams(search).toString()}`;
    expect(target).toBe(`/login?next=${encodeURIComponent(next)}`);

    // The login page keeps that return URL and the login action goes back to it.
    const loginPage = await LoginPage({ searchParams: Promise.resolve({ next }) });
    expect(findElement(loginPage, LoginForm)?.props).toEqual({ next, expired: false });
  });

  it("shows the consent card with client name, redirect host and both buttons for a session", async () => {
    await signIn();
    const page = await render(params());
    const text = renderText(page);
    expect(text).toContain("„Claude“ möchte deine Watchlists lesen und ändern.");
    expect(text).toContain("Weiterleitung an claude.ai");
    expect(text).toContain("Erlauben");
    expect(text).toContain("Ablehnen");
    expect(findElement(page, ConsentForm)?.props).toEqual({ params: params(), offerPortfolioRead: false });
    expect(text).not.toContain("Darf auch Depots");
    expect(renderHtml(page)).not.toContain('name="portfolio_read"');
  });

  it.each(["watchlist portfolio:read", "portfolio:read"])(
    "offers the unchecked portfolio checkbox when scope=%j is requested (acceptance)",
    async (scope) => {
      await signIn();
      const page = await render(params({ scope }));
      expect(renderText(page)).toContain("Darf auch Depots, Bestände, Umsätze und Kennzahlen lesen (nur lesen)");
      expect(findElement(page, ConsentForm)?.props).toEqual({ params: params({ scope }), offerPortfolioRead: true });
      const checkbox = renderHtml(page).match(/<input[^>]*name="portfolio_read"[^>]*>/)?.[0];
      expect(checkbox).toBeDefined();
      expect(checkbox).toContain('type="checkbox"');
      expect(checkbox).not.toMatch(/\bchecked\b/);
    },
  );

  it("shows an error page and never redirects for an unknown client or an unregistered redirect URI", async () => {
    await signIn();
    expect(renderText(await render(params({ client_id: "unknown" })))).toContain("Diese App ist nicht registriert.");
    expect(renderText(await render(params({ redirect_uri: "https://evil.example/cb" })))).toContain(
      "Die Weiterleitungsadresse dieser App ist nicht registriert.",
    );
  });

  it("redirects other request errors to the client with error, state and iss", async () => {
    const url = new URL(await expectRedirect(() => render(params({ code_challenge_method: "plain" }))));
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(Object.fromEntries(url.searchParams)).toEqual({ error: "invalid_request", state: "xyz", iss: APP_URL });
    const missing = new URL(await expectRedirect(() => render(params({ code_challenge: undefined }))));
    expect(missing.searchParams.get("error")).toBe("invalid_request");
  });

  it("shows an error page and never redirects for an over-long request", async () => {
    await signIn();
    const text = renderText(await render(params({ state: "s".repeat(4001) })));
    expect(text).toContain("Die Anfrage dieser App ist zu lang.");
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it("tells that connected apps are not set up while APP_URL is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.APP_URL;
    await signIn();
    expect(renderText(await render(params()))).toContain("APP_URL fehlt");
  });
});

describe("consent decision action", () => {
  it("Erlauben redirects to the client with a new code, state and iss", async () => {
    await signIn();
    const url = new URL(await expectRedirect(() => decideAuthorization(null, formData({ ...params(), decision: "allow" }))));
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("iss")).toBe(APP_URL);
    expect(await prisma.oAuthToken.count({ where: { kind: "CODE" } })).toBe(1);
  });

  it.each([
    ["watchlist portfolio:read", { portfolio_read: "on" }, "watchlist portfolio:read"],
    ["watchlist portfolio:read", {}, "watchlist"],
    ["portfolio:read", { portfolio_read: "on" }, "watchlist portfolio:read"],
    ["portfolio:read", {}, "watchlist"],
    // A forged checkbox without the requested scope grants nothing extra.
    ["watchlist", { portfolio_read: "on" }, "watchlist"],
  ])("Erlauben for scope %j with %j stores a code with scope %j", async (scope, box, expected) => {
    await signIn();
    await expectRedirect(() => decideAuthorization(null, formData({ ...params({ scope }), ...box, decision: "allow" })));
    expect((await prisma.oAuthToken.findFirstOrThrow({ where: { kind: "CODE" } })).scope).toBe(expected);
  });

  it("Ablehnen redirects with error=access_denied and stores no code", async () => {
    await signIn();
    const url = new URL(await expectRedirect(() => decideAuthorization(null, formData({ ...params(), decision: "deny" }))));
    expect(Object.fromEntries(url.searchParams)).toEqual({ error: "access_denied", state: "xyz", iss: APP_URL });
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it("re-checks the session and every parameter", async () => {
    const toLogin = await expectRedirect(() => decideAuthorization(null, formData({ ...params(), decision: "allow" })));
    expect(toLogin.startsWith("/login?next=%2Foauth%2Fauthorize%3F")).toBe(true);
    await signIn();
    expect(await decideAuthorization(null, formData({ ...params({ redirect_uri: "https://evil.example/cb" }), decision: "allow" }))).toEqual({
      error: expect.stringContaining("Weiterleitungsadresse"),
    });
    const tampered = new URL(await expectRedirect(() => decideAuthorization(null, formData({ ...params({ scope: "admin" }), decision: "allow" }))));
    expect(tampered.searchParams.get("error")).toBe("invalid_scope");
    expect(await prisma.oAuthToken.count()).toBe(0);
  });
});
