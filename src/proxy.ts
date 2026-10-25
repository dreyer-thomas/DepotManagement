import { type NextRequest, NextResponse } from "next/server";
import { readAuthConfig } from "@/modules/auth/config";
import { SESSION_COOKIE, verifySessionToken } from "@/modules/auth/session";

// Optimistic auth gate (Next 16 proxy). Imports the jose-only session file, not the module
// index, so bcrypt stays out of the proxy bundle. `(app)/layout.tsx` re-verifies.

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const auth = readAuthConfig(process.env);
  const session = auth.ok ? await verifySessionToken(token, auth.config) : null;
  if (session) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const response = NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (token !== undefined) {
      response.cookies.delete(SESSION_COOKIE);
    }
    return response;
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  if (token !== undefined) {
    loginUrl.searchParams.set("expired", "1");
  }
  const response = NextResponse.redirect(loginUrl);
  if (token !== undefined) {
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: ["/((?!login(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)"],
};
