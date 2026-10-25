import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth/session";
import { config, proxy } from "./proxy";

const SECRET = "test-secret-with-at-least-32-characters";
// Synthetic bcrypt-format hash; the proxy never checks passwords.
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const saved = { ...process.env };

beforeAll(() => {
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
});

afterAll(() => {
  process.env = saved;
});

function request(path: string, cookie?: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (cookie !== undefined) {
    headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  }
  return new NextRequest(new URL(path, "http://localhost:3000"), { method: init.method, headers });
}

function actionRequest(path: string, cookie?: string) {
  return request(path, cookie, { method: "POST", headers: { "next-action": "abc" } });
}

describe("proxy", () => {
  it("redirects a page request without a session to login with the return URL", async () => {
    const response = await proxy(request("/depots?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fdepots%3Fx%3D1");
  });

  it("answers 401 JSON for route handlers", async () => {
    const response = await proxy(request("/api/anything"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("redirects with expired=1 and deletes an expired cookie", async () => {
    const token = await createSessionToken("tester", SECRET, new Date("2020-01-01T00:00:00Z"));
    const response = await proxy(request("/", token));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2F&expired=1");
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });

  it("treats a tampered cookie like an expired one", async () => {
    const token = await createSessionToken("tester", "another-secret-with-at-least-32-chars");
    const response = await proxy(request("/", token));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2F&expired=1");
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
  });

  it("passes a request with a valid session through", async () => {
    const token = await createSessionToken("tester", SECRET);
    const response = await proxy(request("/depots", token));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects every request when the auth configuration is invalid", async () => {
    const token = await createSessionToken("tester", SECRET);
    process.env.SESSION_SECRET = "";
    try {
      expect((await proxy(request("/depots", token))).status).toBe(307);
    } finally {
      process.env.SESSION_SECRET = SECRET;
    }
  });
});

describe("proxy for server actions", () => {
  it("answers an action without a session with an action redirect to login, not a 307", async () => {
    const response = await proxy(actionRequest("/depots?x=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-action-redirect")).toBe("/login?next=%2Fdepots%3Fx%3D1;replace");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("adds expired=1 and deletes an expired cookie for an action", async () => {
    const token = await createSessionToken("tester", SECRET, new Date("2020-01-01T00:00:00Z"));
    const response = await proxy(actionRequest("/", token));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-action-redirect")).toBe("/login?next=%2F&expired=1;replace");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });

  it("still redirects a GET carrying a next-action header with a 307", async () => {
    const response = await proxy(request("/depots", undefined, { headers: { "next-action": "abc" } }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fdepots");
    expect(response.headers.get("x-action-redirect")).toBeNull();
  });

  it("passes an action with a valid session through", async () => {
    const token = await createSessionToken("tester", SECRET);
    const response = await proxy(actionRequest("/depots", token));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-action-redirect")).toBeNull();
  });
});

describe("proxy matcher", () => {
  it.each(["/login", "/login?next=%2Fdepots", "/_next/static/chunks/main.js", "/_next/image?url=x", "/favicon.ico"])(
    "does not guard the public path %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );

  it.each(["/", "/depots", "/depots?x=1", "/api/anything", "/settings", "/loginx", "/favicon.ico.bak"])(
    "guards %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );
});
