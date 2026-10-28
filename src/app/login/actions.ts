"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkCredentials,
  createSessionToken,
  isHttpsRequest,
  readAuthConfig,
  safeReturnUrl,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/modules/auth";

export type LoginState = { failed: boolean; username: string; attempt: number };

const MAX_USERNAME = 256;

const loginInput = z.object({
  username: z.string().max(MAX_USERNAME),
  password: z.string().max(1024),
  // Long enough for an OAuth authorize URL (story 9.4).
  next: z.string().max(4096).optional(),
});

/** Checks the credentials, sets the session cookie and redirects to the sanitized return URL. */
export async function login(previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginInput.safeParse({
    username: formData.get("username") ?? "",
    password: formData.get("password") ?? "",
    next: formData.get("next") ?? undefined,
  });
  const rawUsername = formData.get("username");
  const failed: LoginState = {
    failed: true,
    username: typeof rawUsername === "string" ? rawUsername.slice(0, MAX_USERNAME) : "",
    attempt: previous.attempt + 1,
  };
  if (!parsed.success) {
    return failed;
  }

  const auth = readAuthConfig(process.env);
  if (!auth.ok) {
    return failed;
  }
  const { username, password, next } = parsed.data;
  if (!(await checkCredentials(username, password, auth.config))) {
    return failed;
  }

  const token = await createSessionToken(auth.config.username, auth.config.secret);
  const secure = isHttpsRequest((await headers()).get("x-forwarded-proto"));
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(secure));
  redirect(safeReturnUrl(next));
}
