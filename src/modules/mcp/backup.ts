// OAuth data is never exported (AD-12); a restore clears it so connected apps must reconnect.
import type { McpDb } from "./clients";

/** Deletes every OAuth client, grant, code and token; called inside the restore transaction. */
export async function clearOAuth(db: McpDb): Promise<void> {
  await db.oAuthToken.deleteMany();
  await db.oAuthGrant.deleteMany();
  await db.oAuthClient.deleteMany();
}
