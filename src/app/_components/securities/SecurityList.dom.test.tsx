// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { effective, emptyLayer, emptyManual } from "@/core/classification";
import type { SecurityWithMapping } from "@/modules/prices";
import { LogoProvider } from "./LogoContext";
import { SecurityList } from "./SecurityList";
import { SKIPPED_TEXT } from "./SecurityPriceRefreshButton";

vi.mock("@/app/_actions/securities", () => ({
  resolveMissingMappingsAction: vi.fn(),
  resolveMappingAction: vi.fn(),
  setMappingAction: vi.fn(),
  changeSecurityTypeAction: vi.fn(),
}));
const refreshSecurityPricesAction = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  refreshSecurityPricesAction,
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

/** `aria-label`s of all buttons matching `pattern`, also those in closed "Bearbeiten" popups (hidden, so unnamed for role queries). */
// Popups are portaled to the end of the document, so their buttons come after the cards' own ones.
function buttonLabels(pattern: RegExp): string[] {
  return [...document.querySelectorAll("button[aria-label]")]
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => pattern.test(label));
}

/** Opens the "Bearbeiten" popup of a Security card. */
async function openEdit(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Bearbeiten – ${name}` }));
  return screen.getByRole("group", { name: `Bearbeiten – ${name}` });
}

async function offeredTypes(name: string) {
  const user = userEvent.setup({ delay: null });
  await user.click(within(await openEdit(user, name)).getByRole("button", { name: `Typ ändern – ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: "Typ ändern" });
  await user.click(within(dialog).getByRole("combobox", { name: "Typ" }));
  const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  return options;
}

describe("SecurityList", () => {
  it("filters the list by name, ISIN, crypto symbol or price symbol as you type", async () => {
    const list: SecurityWithMapping[] = [
      ...securities,
      {
        id: "s3",
        name: "EZCORP Inc.",
        isin: "US3021301094",
        cryptoSymbol: null,
        assetType: "STOCK",
        mapping: { provider: "YAHOO", symbol: "EZ2A.F", origin: "MANUAL", fetchError: null },
      },
    ];
    const user = userEvent.setup({ delay: null });
    render(<SecurityList securities={list} today="2026-10-26" />);
    const search = screen.getByRole("searchbox", { name: "Wertpapiere durchsuchen" });
    const names = () => screen.queryAllByRole("link").map((link) => link.textContent);
    expect(names()).toEqual(["Bitcoin", "SAP", "EZCORP Inc."]);

    await user.type(search, "sap");
    expect(names()).toEqual(["SAP"]);
    await user.clear(search);
    await user.type(search, "de000716");
    expect(names()).toEqual(["SAP"]);
    await user.clear(search);
    await user.type(search, "btc");
    expect(names()).toEqual(["Bitcoin"]);
    await user.clear(search);
    await user.type(search, "ez2a.f");
    expect(names()).toEqual(["EZCORP Inc."]);
    await user.clear(search);
    await user.type(search, "ezcorp inc");
    expect(names()).toEqual(["EZCORP Inc."]);

    await user.clear(search);
    await user.type(search, "xyz");
    expect(names()).toEqual([]);
    expect(screen.getByText("Keine Wertpapiere gefunden.")).toBeTruthy();
    await user.clear(search);
    expect(names()).toEqual(["Bitcoin", "SAP", "EZCORP Inc."]);
  });

  it("links each name to the Security page", () => {
    render(<SecurityList securities={securities} today="2026-10-26" />);
    expect(screen.getByRole("link", { name: "Bitcoin" }).getAttribute("href")).toBe("/securities/s1");
    expect(screen.getByRole("link", { name: "SAP" }).getAttribute("href")).toBe("/securities/s2");
  });

  it("filters to Securities with a price problem: stale, missing, failed or without a price source", async () => {
    const yahoo = (symbol: string, fetchError: string | null = null) => ({ provider: "YAHOO" as const, symbol, origin: "MANUAL" as const, fetchError });
    const base = { cryptoSymbol: null, assetType: "STOCK" as const };
    const list: SecurityWithMapping[] = [
      { ...base, id: "ok", name: "Fresh AG", isin: "DE0000000001", mapping: yahoo("FRS.DE") },
      { ...base, id: "stale", name: "Stale AG", isin: "DE0000000002", mapping: yahoo("STL.DE") },
      { ...base, id: "failed", name: "Failed AG", isin: "DE0000000003", mapping: yahoo("FLD.DE", "currency") },
      { ...base, id: "none", name: "Unmapped AG", isin: "DE0000000004", mapping: { provider: null, symbol: null, origin: "AUTO", fetchError: null } },
      { ...base, id: "noprice", name: "Priceless AG", isin: "DE0000000005", mapping: yahoo("PRL.DE") },
    ];
    const info = (stale: boolean) => ({ date: "2026-10-24", source: "provider" as const, fetchedAt: null, provider: "YAHOO" as const, stale });
    const user = userEvent.setup({ delay: null });
    render(
      <SecurityList
        securities={list}
        today="2026-10-26"
        prices={{ ok: info(false), stale: info(true), failed: info(false), none: info(false) }}
      />,
    );
    const names = () => screen.queryAllByRole("link").map((link) => link.textContent);
    expect(names()).toHaveLength(5);

    await user.click(screen.getByRole("switch", { name: "Nur Probleme (4)" }));
    expect(names()).toEqual(["Stale AG", "Failed AG", "Unmapped AG", "Priceless AG"]);
    // Both filters combine.
    await user.type(screen.getByRole("searchbox", { name: "Wertpapiere durchsuchen" }), "fld.de");
    expect(names()).toEqual(["Failed AG"]);
  });

  it("keeps the edit actions in the 'Bearbeiten' popup, which closes when an action opens its dialog", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SecurityList securities={securities} today="2026-10-26" />);
    expect(screen.queryByRole("button", { name: "Kursquelle bearbeiten – SAP" })).toBeNull();
    const popup = await openEdit(user, "SAP");
    expect(within(popup).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Kursquelle bearbeiten – SAP",
      "Typ ändern – SAP",
      "Klassifizierung bearbeiten – SAP",
      "Kurs manuell eintragen – SAP",
      "Logo hochladen – SAP",
    ]);
    await user.click(within(popup).getByRole("button", { name: "Kursquelle bearbeiten – SAP" }));
    expect(await screen.findByRole("dialog", { name: "Kursquelle bearbeiten" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("group", { name: "Bearbeiten – SAP" })).toBeNull());
  });

  it("fetches the Price of one Security with 'Kurs abrufen' and reports the outcome", async () => {
    const mapped: SecurityWithMapping = {
      ...securities[1],
      assetType: "STOCK",
      mapping: { provider: "YAHOO", symbol: "SAP.DE", origin: "MANUAL", fetchError: null },
    };
    const user = userEvent.setup({ delay: null });
    render(<SecurityList securities={[securities[0], mapped]} today="2026-10-26" />);
    // Only mapped Securities offer it.
    expect(screen.queryByRole("button", { name: "Kurs abrufen – Bitcoin" })).toBeNull();
    const button = screen.getByRole("button", { name: "Kurs abrufen – SAP" });

    refreshSecurityPricesAction.mockResolvedValueOnce({ ok: true, status: "updated" });
    await user.click(button);
    expect(refreshSecurityPricesAction).toHaveBeenCalledWith("s2");
    expect((await screen.findByRole("status")).textContent).toBe("Kurs von SAP abgerufen.");
    expect(router.refresh).toHaveBeenCalled();

    refreshSecurityPricesAction.mockResolvedValueOnce({ ok: true, status: "failed", reason: "currency" });
    await user.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Kurs konnte nicht von Yahoo Finance geladen werden. Keine Kurse in EUR für dieses Symbol. Bitte ein Symbol mit Börsenkürzel wählen, z. B. .DE (Xetra) oder .F (Frankfurt).",
    );

    refreshSecurityPricesAction.mockResolvedValueOnce({ ok: true, status: "skipped" });
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SKIPPED_TEXT));
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
    expect(buttonLabels(/^Analysten-Symbol bearbeiten/)).toEqual(["Analysten-Symbol bearbeiten – Apple Inc.", "Analysten-Symbol bearbeiten – SAP SE"]);
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
    await screen.findByRole("button", { name: "Bearbeiten – Bitcoin" });
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
    const error = screen.getByText("Kurs konnte nicht von Yahoo Finance geladen werden. Anbieter nicht erreichbar, bitte später erneut versuchen.");
    expect(error).toBeTruthy();
    // One button per card: in the "Bearbeiten" popup, or as the Alert action on the failed card.
    expect(buttonLabels(/^Kurs manuell eintragen/).sort()).toEqual(["Kurs manuell eintragen – Bitcoin", "Kurs manuell eintragen – SAP"]);
    const action = within(error.closest(".MuiAlert-root") as HTMLElement).getByRole("button", { name: "Kurs manuell eintragen – SAP" });
    const user = userEvent.setup({ delay: null });
    await user.click(action);
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
    expect(buttonLabels(/^Kurs manuell eintragen/)).toHaveLength(2);
  });

  it("shows stored logos from the app route and offers 'Logo hochladen' / 'Logo ersetzen'", () => {
    const { container } = render(
      <LogoProvider versions={{ s2: "1761472800000" }}>
        <SecurityList securities={securities} today="2026-10-26" />
      </LogoProvider>,
    );
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["/api/logos/s2?v=1761472800000"]);
    expect(buttonLabels(/^Logo/)).toEqual(["Logo hochladen – Bitcoin", "Logo ersetzen – SAP"]);
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
    await user.click(within(await openEdit(user, "SAP")).getByRole("button", { name: "Klassifizierung bearbeiten – SAP" }));
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
    expect(buttonLabels(/^Teilfreistellung bearbeiten/)).toEqual([
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
    expect(buttonLabels(/^Regionen bearbeiten/)).toEqual([
      "Regionen bearbeiten – MSCI World",
      "Regionen bearbeiten – Rentenfonds",
      "Regionen bearbeiten – Mein Fonds",
    ]);
  });
});
