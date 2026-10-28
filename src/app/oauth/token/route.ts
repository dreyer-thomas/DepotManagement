// OAuth token endpoint (story 9.4). Public: the proxy lets this path through; clients authenticate here.
import { handleToken } from "@/modules/mcp";

export function POST(request: Request): Promise<Response> {
  return handleToken(request);
}
