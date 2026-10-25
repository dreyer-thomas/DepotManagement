import { jwtVerify, SignJWT } from "jose";

// jose only: this file is imported by src/proxy.ts and must not pull in bcrypt.

export const SESSION_COOKIE = "dm_session";
/** Fixed session lifetime: 7 days, never extended. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const ALGORITHM = "HS256";

export type Session = { username: string };

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Signs a session token with `sub` = username, `iat` = now and `exp` = now + 7 days. */
export async function createSessionToken(username: string, secret: string, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(username)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(key(secret));
}

/** Valid only if the signature, `exp` and `sub === username` all check out; otherwise null. */
export async function verifySessionToken(
  token: string | undefined | null,
  config: { username: string; secret: string },
  now: Date = new Date(),
): Promise<Session | null> {
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, key(config.secret), {
      algorithms: [ALGORITHM],
      requiredClaims: ["exp", "sub"],
      currentDate: now,
    });
    if (payload.sub !== config.username) {
      return null;
    }
    return { username: payload.sub };
  } catch {
    return null;
  }
}

/** Cookie attributes for the session cookie; `secure` only when the request came in over HTTPS. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure,
  };
}

/** True when the first value of `x-forwarded-proto` is `https`. */
export function isHttpsRequest(forwardedProto: string | null | undefined): boolean {
  if (!forwardedProto) {
    return false;
  }
  return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
}
