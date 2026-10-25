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
  // Server actions: the client's action fetch follows a 3xx as a re-POST to /login, where the
  // action is not registered. Answer with Next's own action-redirect contract instead; without
  // RSC content the client hard-navigates to the login URL.
  const response = request.method === "POST" && request.headers.has("next-action")
    ? new NextResponse(null, {
        status: 200,
        headers: { "x-action-redirect": `${loginUrl.pathname}${loginUrl.search};replace` },
      })
    : NextResponse.redirect(loginUrl);
  if (token !== undefined) {
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: ["/((?!login(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)"],
};
