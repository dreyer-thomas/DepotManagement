import { cookies } from "next/headers";
import { readAuthConfig } from "./config";
import { SESSION_COOKIE, type Session, verifySessionToken } from "./session";

export { assertAuthConfig, formatAuthConfigProblems, readAuthConfig } from "./config";
export type { AuthConfig, AuthConfigResult } from "./config";
export { checkCredentials } from "./credentials";
export { safeReturnUrl } from "./return-url";
export {
  createSessionToken,
  isHttpsRequest,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  verifySessionToken,
} from "./session";
export type { Session } from "./session";

/**
 * Current session from the `dm_session` cookie, or null. For server components, server actions
 * and route handlers; returns null when the auth configuration is invalid.
 */
export async function getSession(): Promise<Session | null> {
  // Read the cookie first: it marks the caller as dynamic even when the config is invalid, so a
  // page is never prerendered at build time (where no auth env is set) as a redirect.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const result = readAuthConfig(process.env);
  if (!result.ok) {
    return null;
  }
  return verifySessionToken(token, result.config);
}
