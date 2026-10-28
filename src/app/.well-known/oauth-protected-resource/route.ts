// RFC 9728 protected-resource metadata of `/api/mcp` (story 9.4). Public: the proxy lets this path through.
import { handleProtectedResourceMetadata } from "@/modules/mcp";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return handleProtectedResourceMetadata();
}
