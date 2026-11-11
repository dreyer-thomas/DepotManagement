// The MCP endpoint (story 9.4, AD-22): stateless Streamable HTTP, POST only. The proxy lets it through;
// `handleMcp` accepts only an OAuth access token issued after the single-user login.
import { revalidatePath } from "next/cache";
import { handleMcp, methodNotAllowed } from "@/modules/mcp";
import { schedulePriceBackfill } from "@/app/_actions/price-refresh";

/** After a successful watchlist write: the pages the app's own actions revalidate, plus the backfill. */
function onWatchlistChange({ backfill }: { backfill: boolean }): void {
  revalidatePath("/watchlists");
  revalidatePath("/securities");
  revalidatePath("/securities/[id]", "page");
  if (backfill) schedulePriceBackfill();
}

/** After a successful `set_price_marks`: every page that shows marks or their breaches (as the app's marks action). */
function onPriceMarksChange(): void {
  revalidatePath("/");
  revalidatePath("/securities");
  revalidatePath("/securities/[id]", "page");
  revalidatePath("/watchlists");
}

export function POST(request: Request): Promise<Response> {
  return handleMcp(request, { onWatchlistChange, onPriceMarksChange });
}

export function GET(): Response {
  return methodNotAllowed("POST");
}

export function DELETE(): Response {
  return methodNotAllowed("POST");
}
