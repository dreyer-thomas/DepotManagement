// RFC 8414 authorization-server metadata (story 9.4). Public: the proxy lets this path through.
import { handleAuthorizationServerMetadata } from "@/modules/mcp";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return handleAuthorizationServerMetadata();
}
