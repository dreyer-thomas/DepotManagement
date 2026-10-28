import { describe, expect, it, vi } from "vitest";
import { PORTFOLIO_READ_DENIED_MESSAGE, requirePortfolioRead } from "./portfolio-tools";
import type { McpToolContext } from "./tools";

const context = (scopes: string[]) => ({ scopes }) as unknown as McpToolContext;
const OK = { content: [{ type: "text" as const, text: "{}" }] };

describe("requirePortfolioRead", () => {
  it("refuses without portfolio:read and never calls the body", async () => {
    const body = vi.fn(async () => OK);
    const result = await requirePortfolioRead(context(["watchlist"]), body)({});
    expect(body).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      error: "portfolio-read-required",
      message: PORTFOLIO_READ_DENIED_MESSAGE,
    });
    expect(PORTFOLIO_READ_DENIED_MESSAGE).toBe("Keine Berechtigung für Depotdaten");
  });

  it("runs the body with portfolio:read", async () => {
    const body = vi.fn(async () => OK);
    expect(await requirePortfolioRead(context(["watchlist", "portfolio:read"]), body)({ a: 1 })).toBe(OK);
    expect(body).toHaveBeenCalledWith({ a: 1 });
  });
});
