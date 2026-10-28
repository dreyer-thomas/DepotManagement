"use server";

import { cookies, headers } from "next/headers";
import { businessDate } from "@/core/dates";
import { isSelectablePeriod, parsePeriod, serializePeriod } from "@/core/period";
import { getSession, isHttpsRequest } from "@/modules/auth";
import { PERIOD_COOKIE, periodCookieOptions } from "./period-cookie";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

export type SetPeriodActionResult = { ok: true } | typeof UNAUTHORIZED | { ok: false; reason: "invalid" };

/**
 * Stores the global Period choice (`1T|1W|1M|YTD|1J|3J` or `custom:YYYY-MM-DD:YYYY-MM-DD`, validated by
 * `core/period` against today; `MAX` is no longer selectable) in the Period cookie. The caller refreshes the page.
 */
export async function setPeriodAction(text: unknown): Promise<SetPeriodActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const selection = parsePeriod(text, businessDate(new Date()));
  if (!selection || !isSelectablePeriod(selection)) return { ok: false, reason: "invalid" };
  const secure = isHttpsRequest((await headers()).get("x-forwarded-proto"));
  (await cookies()).set(PERIOD_COOKIE, serializePeriod(selection), periodCookieOptions(secure));
  return { ok: true };
}
