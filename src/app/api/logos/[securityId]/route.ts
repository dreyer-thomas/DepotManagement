// Serves stored Security logos from the app's own origin (the browser never calls a logo provider).
// The proxy already answers /api/* without a session with 401; the handler re-checks.
import { getSession } from "@/modules/auth";
import { readLogo } from "@/modules/logos";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

function error(status: 401 | 404, message: string): Response {
  return Response.json({ error: message }, { status, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" } });
}

/** The stored logo of a Security: 401 without a session, 404 for an unknown Security or the marker. */
export async function GET(_request: Request, { params }: { params: Promise<{ securityId: string }> }): Promise<Response> {
  if (!(await getSession())) return error(401, "unauthorized");
  const { securityId } = await params;
  const logo = await readLogo(securityId);
  if (!logo) return error(404, "not-found");
  return new Response(new Uint8Array(logo.bytes), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": logo.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
