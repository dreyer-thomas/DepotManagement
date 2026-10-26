// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { PositionRecord } from "@/modules/ledger";
import { LogoProvider } from "../securities/LogoContext";
import { PositionsTable } from "./PositionsTable";

registerDomCleanup();

const stale: PositionRecord = {
  security: { id: "s1", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" },
  quantity: "2",
  costBasis: "200",
  averagePrice: "100",
  price: "100",
  priceDate: "2026-10-22",
  priceSource: "provider",
  priceFetchedAt: "2026-10-22T18:05:00.000Z",
  priceProvider: "YAHOO",
  value: "200",
  gain: "0",
  gainRatio: "0",
};

describe("PositionsTable stale badge", () => {
  it("shows the Position's price source and fetch time in the badge tooltip", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PositionsTable positions={[stale]} cashBalance="0" today="2026-10-26" readOnly />);
    const [badge] = screen.getAllByText("Kurs vom 22.10.2026 – veraltet");
    // Tab to the badge (keyboard focus, no hover).
    for (let tabs = 0; tabs < 20 && document.activeElement !== badge; tabs++) await user.tab();
    expect(document.activeElement).toBe(badge);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Yahoo Finance · abgerufen 22.10.2026, 20:05");
  });
});

describe("PositionsTable logos", () => {
  it("loads the Position's stored logo by its Security id in the desktop and phone layouts", () => {
    const { container } = render(
      <LogoProvider versions={{ s1: "1" }}>
        <PositionsTable positions={[stale]} cashBalance="0" today="2026-10-26" readOnly />
      </LogoProvider>,
    );
    const table = container.querySelector("table") as HTMLElement;
    const logos = [...container.querySelectorAll('img[src="/api/logos/s1?v=1"]')];
    expect(logos).toHaveLength(2);
    expect(logos.filter((img) => table.contains(img))).toHaveLength(1);
  });
});
