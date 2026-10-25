import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  isHttpsRequest,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  verifySessionToken,
} from "./session";

const SECRET = "test-secret-with-at-least-32-characters";
const config = { username: "tester", secret: SECRET };
const now = new Date("2026-10-25T12:00:00Z");

describe("session tokens", () => {
  it("round-trips a token", async () => {
    const token = await createSessionToken("tester", SECRET, now);
    expect(await verifySessionToken(token, config, now)).toEqual({ username: "tester" });
  });

  it("sets iat and a fixed exp of 7 days", async () => {
    const token = await createSessionToken("tester", SECRET, now);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(payload.sub).toBe("tester");
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
    expect(SESSION_TTL_SECONDS).toBe(604800);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken("tester", SECRET, now);
    const later = new Date(now.getTime() + (SESSION_TTL_SECONDS + 1) * 1000);
    expect(await verifySessionToken(token, config, later)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken("tester", SECRET, now);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "tester", exp: 9999999999 })).toString("base64url");
    expect(await verifySessionToken(`${header}.${forged}.${signature}`, config, now)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await createSessionToken("tester", "another-secret-with-at-least-32-chars", now);
    expect(await verifySessionToken(token, config, now)).toBeNull();
  });

  it("rejects a token for another username", async () => {
    const token = await createSessionToken("someone-else", SECRET, now);
    expect(await verifySessionToken(token, config, now)).toBeNull();
  });

  it("rejects a token without exp", async () => {
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("tester").sign(
      new TextEncoder().encode(SECRET),
    );
    expect(await verifySessionToken(token, config, now)).toBeNull();
  });

  it("rejects missing and garbage tokens", async () => {
    expect(await verifySessionToken(undefined, config, now)).toBeNull();
    expect(await verifySessionToken("", config, now)).toBeNull();
    expect(await verifySessionToken("not.a.token", config, now)).toBeNull();
  });
});

describe("cookie attributes", () => {
  it("is httpOnly, lax, path / with a 7-day max age", () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
      secure: false,
    });
    expect(sessionCookieOptions(true).secure).toBe(true);
  });

  it("detects HTTPS from the first x-forwarded-proto value", () => {
    expect(isHttpsRequest("https")).toBe(true);
    expect(isHttpsRequest("https, http")).toBe(true);
    expect(isHttpsRequest("http, https")).toBe(false);
    expect(isHttpsRequest(null)).toBe(false);
    expect(isHttpsRequest("")).toBe(false);
  });
});
