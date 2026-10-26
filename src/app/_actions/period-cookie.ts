// The global Period choice (Overview, Depot detail, Security detail) lives in one cookie. Not a server
// action file: server components read it here; `period.ts` writes it.
import { cookies } from "next/headers";
import { DEFAULT_PERIOD, parsePeriod, type PeriodSelection } from "@/core/period";

export const PERIOD_COOKIE = "dm_period";

/** About one year. */
export const PERIOD_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function periodCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: PERIOD_COOKIE_MAX_AGE, secure };
}

/** The stored Period for server components; a missing or invalid cookie gives `DEFAULT_PERIOD` (1J). */
export async function readPeriod(today: string): Promise<PeriodSelection> {
  return parsePeriod((await cookies()).get(PERIOD_COOKIE)?.value, today) ?? DEFAULT_PERIOD;
}
