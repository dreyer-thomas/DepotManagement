// Opaque tokens, hashes and PKCE (AD-22). Only SHA-256 hex hashes of codes, tokens and secrets are stored.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A new opaque secret: 32 random bytes, base64url (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A new public client id: 16 random bytes, base64url. */
export function randomClientId(): string {
  return randomBytes(16).toString("base64url");
}

/** SHA-256 hex hash under which a code, token or client secret is stored. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two strings (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** RFC 7636 code verifier / challenge alphabet and length (43–128 unreserved characters). */
const PKCE_VALUE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** True for a syntactically valid S256 code challenge (base64url of a SHA-256 digest, 43 characters). */
export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** `BASE64URL(SHA256(verifier))` (RFC 7636 S256). */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** True when `verifier` is a valid RFC 7636 verifier whose S256 challenge equals `challenge`. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !PKCE_VALUE.test(verifier)) return false;
  return safeEqual(s256Challenge(verifier), challenge);
}
