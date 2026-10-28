// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { effective, emptyLayer, emptyManual } from "@/core/classification";
import type { SecurityWithMapping } from "@/modules/prices";
import { LogoProvider } from "./LogoContext";
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

vi.mock("@/app/_actions/logos", () => ({ uploadLogoAction: vi.fn() }));
vi.mock("@/app/_actions/classification", () => ({
  setClassificationAction: vi.fn(),
  setRegionSplitAction: vi.fn(),
  setAnalystSymbolAction: vi.fn(),
}));
vi.mock("@/app/_actions/tax", () => ({ setTeilfreistellungAction: vi.fn() }));

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
  it("links each name to the Security page", () => {
    render(<SecurityList securities={securities} today="2026-10-26" />);
    expect(screen.getByRole("link", { name: "Bitcoin" }).getAttribute("href")).toBe("/securities/s1");
    expect(screen.getByRole("link", { name: "SAP" }).getAttribute("href")).toBe("/securities/s2");
  });

  it("shows the Analysten-Symbol line and button for stocks only (story 9.7)", () => {
    const list: SecurityWithMapping[] = [
      { id: "a1", name: "Apple Inc.", isin: "US0378331005", cryptoSymbol: null, assetType: "STOCK", mapping: null },
      { id: "a2", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK", mapping: null },
      { id: "e1", name: "MSCI World", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF", mapping: null },
    ];
    render(<SecurityList securities={list} analystSymbols={{ a1: { symbol: "AAPL", manual: false } }} today="2026-10-26" />);
    expect(screen.getByText("Analysten-Symbol: AAPL").closest("li")?.textContent).toContain("Apple Inc.");
    expect(screen.getByText("Analysten-Symbol: automatisch").closest("li")?.textContent).toContain("SAP SE");
    expect(screen.getByRole("button", { name: "Analysten-Symbol bearbeiten – Apple Inc." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Analysten-Symbol bearbeiten – MSCI World" })).toBeNull();
    expect(screen.getAllByText(/^Analysten-Symbol:/)).toHaveLength(2);
  });

  it("marks watchlist-only Securities with the Watchlist chip", () => {
    render(<SecurityList securities={securities} watchlistOnly={new Set(["s2"])} today="2026-10-26" />);
    expect(screen.getAllByText("Watchlist")).toHaveLength(1);
    expect(screen.getByText("Watchlist").closest("li")?.textContent).toContain("SAP");
  });

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

  it("shows stored logos from the app route and offers 'Logo hochladen' / 'Logo ersetzen'", () => {
    const { container } = render(
      <LogoProvider versions={{ s2: "1761472800000" }}>
        <SecurityList securities={securities} today="2026-10-26" />
      </LogoProvider>,
    );
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["/api/logos/s2?v=1761472800000"]);
    expect(screen.getByRole("button", { name: "Logo hochladen – Bitcoin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Logo ersetzen – SAP" })).toBeTruthy();
  });

  it("shows the classification summary per card ('Unbekannt' for unknown values) and opens its dialog", async () => {
    const automatic = emptyLayer();
    automatic.assetClass = { value: "Aktien", source: "RULE" };
    automatic.region = { value: "Europa", source: "PROVIDER" };
    automatic.currency = { value: "EUR", source: "PROVIDER" };
    const classification = effective({ automatic, manual: { ...emptyManual(), sector: "Halbleiter" } }, "STOCK");
    render(<SecurityList securities={securities} today="2026-10-26" classifications={{ s2: classification }} />);
    expect(screen.getByText("Aktien · Halbleiter · Europa · Unbekannt · Unbekannt · EUR")).toBeTruthy();
    // Bitcoin has no classification yet.
    expect(screen.getByText("Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt")).toBeTruthy();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Klassifizierung bearbeiten – SAP" }));
    const dialog = await screen.findByRole("dialog", { name: "Klassifizierung bearbeiten" });
    expect(within(dialog).getByRole("combobox", { name: "Sektor" }).textContent).toBe("Halbleiter");
  });

  it("shows the Teilfreistellung line and button for funds only", () => {
    const automatic = emptyLayer();
    automatic.assetClass = { value: "Aktien", source: "RULE" };
    const funds: SecurityWithMapping[] = [
      { id: "f1", name: "MSCI World", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF", mapping: null },
      { id: "f2", name: "Rentenfonds", isin: "DE0008474008", cryptoSymbol: null, assetType: "FUND", mapping: null },
      ...securities,
    ];
    render(
      <SecurityList
        securities={funds}
        today="2026-10-26"
        classifications={{ f1: effective({ automatic, manual: emptyManual() }, "ETF") }}
        teilfreistellungOverrides={{ f2: "0.15" }}
      />,
    );
    expect(screen.getByText("Teilfreistellung 30 % (automatisch)")).toBeTruthy();
    expect(screen.getByText("Teilfreistellung 15 % (manuell)")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Teilfreistellung bearbeiten/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Teilfreistellung bearbeiten – MSCI World",
      "Teilfreistellung bearbeiten – Rentenfonds",
    ]);
  });

  it("shows the region split line of funds with a split and the Regionen button for every fund", () => {
    const funds: SecurityWithMapping[] = [
      { id: "f1", name: "MSCI World", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF", mapping: null },
      { id: "f2", name: "Rentenfonds", isin: "DE0008474008", cryptoSymbol: null, assetType: "FUND", mapping: null },
      { id: "f3", name: "Mein Fonds", isin: "DE0008474009", cryptoSymbol: null, assetType: "FUND", mapping: null },
      ...securities,
    ];
    const world = [
      { region: "USA" as const, weight: "72" },
      { region: "Europa" as const, weight: "15" },
      { region: "Japan" as const, weight: "6" },
      { region: "Pazifik ohne Japan" as const, weight: "4" },
      { region: "Sonstige" as const, weight: "3" },
    ];
    const manual = [
      { region: "USA" as const, weight: "60" },
      { region: "Europa" as const, weight: "37.5" },
      { region: "Sonstige" as const, weight: "2.5" },
    ];
    render(
      <SecurityList
        securities={funds}
        today="2026-10-26"
        regionSplits={{
          f1: { effective: { weights: world, source: "rule", index: "MSCI World", asOf: "2026-09-30" }, manual: null, rule: null },
          f2: { effective: null, manual: null, rule: null },
          f3: { effective: { weights: manual, source: "manual", index: null, asOf: null }, manual, rule: null },
        }}
      />,
    );
    expect(
      screen.getByText("Regionen: USA 72 % · Europa 15 % · Japan 6 % · Pazifik ohne Japan 4 % · Sonstige 3 % (Regel MSCI World, Stand 30.09.2026)"),
    ).toBeTruthy();
    expect(screen.getByText("Regionen: USA 60 % · Europa 37,5 % · Sonstige 2,5 % (manuell)")).toBeTruthy();
    expect(screen.getAllByText(/^Regionen:/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Regionen bearbeiten/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Regionen bearbeiten – MSCI World",
      "Regionen bearbeiten – Rentenfonds",
      "Regionen bearbeiten – Mein Fonds",
    ]);
  });
});
