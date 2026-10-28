// RFC 9728 protected-resource metadata, path-suffixed form for the resource `/api/mcp` (story 9.4).
import { handleProtectedResourceMetadata } from "@/modules/mcp";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return handleProtectedResourceMetadata();
}
