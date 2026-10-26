// Download of the full JSON export (story 6.1). The proxy already answers /api/* without a session with
// 401; the handler re-checks. Logs never contain amounts or file content.
import { getSession } from "@/modules/auth";
import { createExport, exportFileName, serializeExport } from "@/modules/backup";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

function error(status: 401 | 500, message: string): Response {
  return Response.json({ error: message }, { status, headers: SECURITY_HEADERS });
}

/** All data as `depotmanagement-export-<YYYYMMDD-HHMMSS>.json`: 401 without a session. */
export async function GET(): Promise<Response> {
  if (!(await getSession())) return error(401, "unauthorized");
  const now = new Date();
  let body: string;
  try {
    body = serializeExport(await createExport());
  } catch (failure) {
    console.error(`Export: creating the export failed (${failure instanceof Error ? failure.name : "unknown"})`);
    return error(500, "export-failed");
  }
  return new Response(body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
    },
  });
}
