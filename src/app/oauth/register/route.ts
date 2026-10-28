// RFC 7591 dynamic client registration (story 9.4). Public: the proxy lets this path through.
import { handleRegister } from "@/modules/mcp";

export function POST(request: Request): Promise<Response> {
  return handleRegister(request);
}
