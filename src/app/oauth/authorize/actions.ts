"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth";
import {
  approveAuthorization,
  AUTHORIZE_PARAM_NAMES,
  type AuthorizeParams,
  denyAuthorization,
  readMcpConfig,
  validateAuthorizeRequest,
} from "@/modules/mcp";
import { authorizePath, ERROR_PAGE_MESSAGES, NOT_CONFIGURED_MESSAGE } from "./messages";

/** `null` before a decision; an error text when the request can no longer be completed. */
export type ConsentState = { error: string } | null;

/**
 * "Erlauben" / "Ablehnen": re-checks the session and every parameter, then redirects to the client with a
 * new code or `error=access_denied` (both with `state` and `iss`). The checked `portfolio_read` box adds
 * `portfolio:read` only when the request named that scope.
 */
export async function decideAuthorization(_previous: ConsentState, formData: FormData): Promise<ConsentState> {
  const config = readMcpConfig(process.env);
  if (!config) {
    console.error("OAuth/MCP: APP_URL is missing or invalid");
    return { error: NOT_CONFIGURED_MESSAGE };
  }
  const params: AuthorizeParams = {};
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const value = formData.get(name);
    if (typeof value === "string") params[name] = value;
  }
  if (!(await getSession())) {
    redirect(`/login?next=${encodeURIComponent(authorizePath(params))}`);
  }
  const validation = await validateAuthorizeRequest(params, config);
  if (validation.kind === "error-page") return { error: ERROR_PAGE_MESSAGES[validation.reason] };
  if (validation.kind === "redirect") redirect(validation.url);
  const target =
    formData.get("decision") === "allow"
      ? await approveAuthorization(validation.request, config, undefined, undefined, formData.get("portfolio_read") === "on")
      : denyAuthorization(validation.request, config);
  redirect(target);
}
