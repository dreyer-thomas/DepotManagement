import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
import type { AuthConfig } from "./config";

function sameUsername(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual needs equal lengths; compare against itself on mismatch to keep the work similar.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Checks username and password. bcrypt.compare always runs, also for a wrong username,
 * so a failure does not reveal which field was wrong.
 */
export async function checkCredentials(
  username: string,
  password: string,
  config: Pick<AuthConfig, "username" | "passwordHash">,
): Promise<boolean> {
  const userOk = sameUsername(username, config.username);
  const passwordOk = await bcrypt.compare(password, config.passwordHash);
  return userOk && passwordOk;
}
