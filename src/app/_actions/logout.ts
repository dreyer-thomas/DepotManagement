"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/modules/auth";

/** Deletes the session cookie and returns to the login page. */
export async function logout(): Promise<never> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
