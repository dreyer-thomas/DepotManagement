// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { SecurityWithMapping } from "@/modules/prices";
import { SecurityList } from "./SecurityList";

vi.mock("@/app/_actions/securities", () => ({
  resolveMissingMappingsAction: vi.fn(),
  resolveMappingAction: vi.fn(),
  setMappingAction: vi.fn(),
  changeSecurityTypeAction: vi.fn(),
}));
vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

registerDomCleanup();

const securities: SecurityWithMapping[] = [
  { id: "s1", name: "Bitcoin", isin: null, cryptoSymbol: "BTC", assetType: "CRYPTO", mapping: null },
  { id: "s2", name: "SAP", isin: "DE0007164600", cryptoSymbol: null, assetType: "UNCLASSIFIED", mapping: null },
];

async function offeredTypes(name: string) {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole("button", { name: `Typ ändern – ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: "Typ ändern" });
  await user.click(within(dialog).getByRole("combobox", { name: "Typ" }));
  const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  return options;
}

describe("SecurityList", () => {
  it("offers the types allowed for each identifier in 'Typ ändern'", async () => {
    render(<SecurityList securities={securities} today="2026-10-26" />);
    expect(await offeredTypes("SAP")).toEqual(["Aktie", "ETF", "Fonds", "Zertifikat"]);
    await screen.findByRole("button", { name: "Typ ändern – Bitcoin" });
    expect(await offeredTypes("Bitcoin")).toEqual(["Krypto"]);
  });

  it("shows the latest price date, the stale badge and the fetch error with the manual-price action", async () => {
    const mapped = (fetchError: string | null) => ({ provider: "YAHOO" as const, symbol: "SAP.DE", origin: "AUTO" as const, fetchError });
    const rows: SecurityWithMapping[] = [
      { ...securities[0], mapping: null },
      { ...securities[1], assetType: "STOCK", mapping: mapped("network") },
    ];
    render(
      <SecurityList
        securities={rows}
        today="2026-10-26"
        prices={{
          s1: { date: "2026-10-24", source: "transaction", fetchedAt: null, provider: null, stale: false },
          s2: { date: "2026-10-22", source: "provider", fetchedAt: "2026-10-22T18:05:00.000Z", provider: "YAHOO", stale: true },
        }}
      />,
    );
    expect(screen.getByText("Kurs vom 24.10.2026")).toBeTruthy();
    expect(screen.getByText("Kurs vom 22.10.2026 – veraltet")).toBeTruthy();
    const error = screen.getByText("Kurs konnte nicht von Yahoo Finance geladen werden.");
    expect(error).toBeTruthy();
    // One button per card: in the action row, or as the Alert action on the failed card.
    const buttons = screen.getAllByRole("button", { name: /^Kurs manuell eintragen/ });
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Kurs manuell eintragen – Bitcoin",
      "Kurs manuell eintragen – SAP",
    ]);
    expect(error.closest(".MuiAlert-root")?.contains(buttons[1])).toBe(true);
    const user = userEvent.setup({ delay: null });
    await user.click(buttons[1]);
    expect(await screen.findByRole("dialog", { name: "Kurs manuell eintragen" })).toBeTruthy();
  });

  it("lists the manual Prices of a Security with date, price and edit/delete actions", async () => {
    render(
      <SecurityList
        securities={securities}
        today="2026-10-26"
        manualPrices={{
          s2: [
            { id: "p2", date: "2026-10-22", price: "1234.56789" },
            { id: "p1", date: "2026-10-20", price: "12.3" },
          ],
        }}
      />,
    );
    expect(screen.getAllByText("Manuelle Kurse")).toHaveLength(1);
    const list = screen.getByRole("list", { name: "Manuelle Kurse – SAP" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "22.10.20261.234,56789\u00a0€BearbeitenLöschen",
      "20.10.202612,3\u00a0€BearbeitenLöschen",
    ]);
    expect(within(items[0]).getByRole("button", { name: "Manuellen Kurs vom 22.10.2026 bearbeiten – SAP" })).toBeTruthy();
    expect(within(items[0]).getByRole("button", { name: "Manuellen Kurs vom 22.10.2026 löschen – SAP" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Kurs manuell eintragen/ })).toHaveLength(2);
  });
});
