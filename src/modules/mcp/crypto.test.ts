import { describe, expect, it } from "vitest";
import { hashSecret, isValidCodeChallenge, randomToken, s256Challenge, verifyPkce } from "./crypto";

// RFC 7636 Appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE S256", () => {
  it("computes the RFC 7636 example challenge and verifies it", () => {
    expect(s256Challenge(VERIFIER)).toBe(CHALLENGE);
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(isValidCodeChallenge(CHALLENGE)).toBe(true);
  });

  it("refuses a wrong, short, long or malformed verifier", () => {
    expect(verifyPkce(`${VERIFIER.slice(0, -1)}A`, CHALLENGE)).toBe(false);
    expect(verifyPkce("short", s256Challenge("short"))).toBe(false);
    expect(verifyPkce("a".repeat(129), s256Challenge("a".repeat(129)))).toBe(false);
    expect(verifyPkce(`${"a".repeat(42)}!`, s256Challenge(`${"a".repeat(42)}!`))).toBe(false);
    expect(verifyPkce(undefined, CHALLENGE)).toBe(false);
    // `plain` would send the verifier itself as the challenge.
    expect(verifyPkce(VERIFIER, VERIFIER)).toBe(false);
  });

  it.each(["", "abc", `${CHALLENGE}x`, `${CHALLENGE.slice(0, -1)}=`, 42])("refuses the challenge %j", (value) => {
    expect(isValidCodeChallenge(value)).toBe(false);
  });
});

describe("tokens", () => {
  it("are 32 random bytes base64url, stored as a sha256 hex hash", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(hashSecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
