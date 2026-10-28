"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth";
import { disconnectAllApps, disconnectApp, type DisconnectAllAppsResult, type DisconnectAppResult } from "@/modules/mcp";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

/** Result of "Trennen". */
export type DisconnectAppActionResult = DisconnectAppResult | Unauthorized;

/** Result of "Alle trennen". */
export type DisconnectAllAppsActionResult = DisconnectAllAppsResult | Unauthorized;

const SETTINGS_PATH = "/settings";

/** "Trennen": revokes one connected app; Claude loses access immediately. */
export async function disconnectAppAction(grantId: unknown): Promise<DisconnectAppActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await disconnectApp(grantId);
  // not-found: the connection is gone already; refresh so it disappears.
  revalidatePath(SETTINGS_PATH);
  return result;
}

/** "Alle trennen": revokes every connected app in one transaction. */
export async function disconnectAllAppsAction(): Promise<DisconnectAllAppsActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await disconnectAllApps();
  revalidatePath(SETTINGS_PATH);
  return result;
}
