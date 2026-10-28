// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { WatchlistEntryView } from "@/modules/watchlist";
import { LogoProvider } from "../securities/LogoContext";
import { type WatchlistColumnKey } from "./watchlist-cookie";
import { type WatchlistKeyFigures, WatchlistTable } from "./WatchlistTable";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/app/_actions/watchlists", () => ({
  addWatchlistEntryAction: vi.fn(),
  updateWatchlistEntryAction: vi.fn(),
  removeWatchlistEntryAction: vi.fn(),
}));

registerDomCleanup();

beforeEach(() => push.mockReset());

function entry(overrides: Partial<WatchlistEntryView> & { id: string; name: string }): WatchlistEntryView {
  const { id, name, ...rest } = overrides;
  return {
    id,
    watchlistId: "w1",
    securityId: `s-${id}`,
    note: "",
    dateAdded: "2026-10-01",
    position: 1,
    source: "APP",
    clientName: null,
    price: null,
    priceDate: null,
    priceSource: null,
    priceFetchedAt: null,
    priceProvider: null,
    stale: false,
    changeToday: null,
    sinceAdded: null,
    held: false,
    fiftyTwoWeek: { high: null, low: null, distanceToHigh: null, performance: null },
    security: { id: `s-${id}`, name, isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" },
    ...rest,
  };
}

const SAP = entry({
  id: "e1",
  name: "SAP SE",
  note: "\nKGV niedrig\nzweite Zeile",
  dateAdded: "2026-10-01",
  price: "26",
  priceDate: "2026-10-27",
  priceSource: "provider",
  priceFetchedAt: "2026-10-27T18:05:00.000Z",
  priceProvider: "YAHOO",
  changeToday: { perUnit: "1", ratio: "0.04" },
  sinceAdded: "0.04",
  held: true,
  fiftyTwoWeek: { high: { price: "27.4", date: "2026-09-01" }, low: { price: "20", date: "2026-03-01" }, distanceToHigh: "-0.052", performance: "0.1" },
});
const BTC = entry({
  id: "e2",
  name: "Bitcoin",
  dateAdded: "2026-10-20",
  source: "MCP",
  clientName: "Claude",
  price: "60000",
  priceDate: "2026-10-20",
  priceSource: "provider",
  priceFetchedAt: "2026-10-20T18:05:00.000Z",
  priceProvider: "COINGECKO",
  stale: true,
  changeToday: { perUnit: "-600", ratio: "-0.01" },
  sinceAdded: "-0.2",
  security: { id: "s-e2", name: "Bitcoin", isin: null, cryptoSymbol: "BTC", assetType: "CRYPTO" },
});
const NEW = entry({ id: "e3", name: "Allianz", dateAdded: "2026-10-10" });

const LISTS = [{ id: "w1", name: "Ideen" }];

const KEY_FIGURES: Record<string, WatchlistKeyFigures> = {
  "s-e1": { trailingPE: "30.4321", dividendYield: "0.0118", analysts: { consensus: "Optimistisch", count: 31 } },
};

function renderTable(entries = [SAP, BTC, NEW], initialColumns: WatchlistColumnKey[] = []) {
  const result = render(
    <LogoProvider versions={{}}>
      <WatchlistTable entries={entries} lists={LISTS} today="2026-10-28" keyFigures={KEY_FIGURES} initialColumns={initialColumns} />
    </LogoProvider>,
  );
  const table = result.container.querySelector("table") as HTMLElement;
  return { ...result, table };
}

const rowNames = (table: HTMLElement) =>
  [...table.querySelectorAll("tbody tr")].map((row) => row.querySelector("a")?.textContent);

describe("WatchlistTable", () => {
  it("shows logo, name, identifier, Price with date / stale badge, changes, date added, first note line and chips", () => {
    const { table } = renderTable();
    const [btcRow, allianzRow, sapRow] = [...table.querySelectorAll("tbody tr")] as HTMLElement[];
    // Default: date added newest first.
    expect(rowNames(table)).toEqual(["Bitcoin", "Allianz", "SAP SE"]);
    const sap = sapRow.textContent!;
    expect(sap).toContain("SAP SE");
    expect(sap).toContain("DE0007164600");
    expect(sap).toContain("im Bestand");
    expect(sap).toContain("26,00 €");
    expect(sap).toContain("Kurs vom 27.10.2026");
    expect(sap).toContain("+4,00 %");
    expect(sap).toContain("+1,00 €");
    expect(sap).toContain("01.10.2026");
    expect(sap).toContain("KGV niedrig");
    expect(sap).not.toContain("zweite Zeile");
    expect(sapRow.querySelector("a")?.getAttribute("href")).toBe("/securities/s-e1");

    const btc = btcRow.textContent!;
    expect(btc).toContain("BTC");
    expect(btc).toContain("via Claude");
    expect(btc).not.toContain("im Bestand");
    expect(btc).toContain("Kurs vom 20.10.2026 – veraltet");
    expect(btc).toContain("-1,00 %");
    expect(btc).toContain("-20,00 %");

    expect(allianzRow.textContent).toContain("Allianz");
    expect(allianzRow.textContent?.match(/–/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("reorders rows when clicking a sortable header (nulls last both ways)", async () => {
    const user = userEvent.setup({ delay: null });
    const { table } = renderTable();
    await user.click(within(table).getByRole("button", { name: "Seit Aufnahme" }));
    expect(rowNames(table)).toEqual(["SAP SE", "Bitcoin", "Allianz"]);
    await user.click(within(table).getByRole("button", { name: "Seit Aufnahme" }));
    expect(rowNames(table)).toEqual(["Bitcoin", "SAP SE", "Allianz"]);
    await user.click(within(table).getByRole("button", { name: "Wertpapier" }));
    expect(rowNames(table)).toEqual(["Allianz", "Bitcoin", "SAP SE"]);
    await user.click(within(table).getByRole("button", { name: "Heute" }));
    expect(rowNames(table)).toEqual(["SAP SE", "Bitcoin", "Allianz"]);
  });

  it("opens the Security detail on a row click and the edit dialog from the pencil", async () => {
    const user = userEvent.setup({ delay: null });
    const { table } = renderTable([SAP]);
    await user.click(table.querySelector("tbody tr td:nth-child(5)") as HTMLElement);
    expect(push).toHaveBeenCalledWith("/securities/s-e1");
    push.mockReset();
    await user.click(within(table).getByRole("button", { name: "SAP SE bearbeiten" }));
    expect(push).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Eintrag bearbeiten" });
    expect((within(dialog).getByRole("textbox", { name: "Notiz" }) as HTMLTextAreaElement).value).toBe(SAP.note);
  });

  it("renders stacked rows for phones with the same entries", () => {
    const { container } = renderTable();
    const list = container.querySelector('ul[aria-label="Watchlist-Einträge"]') as HTMLElement;
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list.textContent).toContain("seit Aufnahme");
  });

  it("shows an empty text without entries", () => {
    renderTable([]);
    expect(screen.getByText("Noch keine Wertpapiere auf dieser Watchlist.")).toBeDefined();
  });

  it("hides the key-figure columns by default; the column menu toggles them and remembers the choice", async () => {
    document.cookie = "dm_watchlist_columns=; max-age=0; path=/";
    const user = userEvent.setup({ delay: null });
    const { table } = renderTable();
    const headers = () => [...table.querySelectorAll("thead th")].map((cell) => cell.textContent);
    expect(headers()).not.toContain("KGV");
    await user.click(screen.getByRole("button", { name: "Spalten" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "KGV" }));
    expect(headers()).toContain("KGV");
    expect(screen.getByRole("menuitemcheckbox", { name: "KGV" }).getAttribute("aria-checked")).toBe("true");
    expect(document.cookie).toContain("dm_watchlist_columns=kgv");
    const sapRow = [...table.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes("SAP SE")) as HTMLElement;
    expect(sapRow.textContent).toContain("30,43");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "KGV" }));
    expect(headers()).not.toContain("KGV");
  });

  it("shows the chosen figures as columns and as a caption line in the phone rows ('–' when missing)", () => {
    const { table, container } = renderTable([SAP, BTC], ["kgv", "dividendYield", "distanceToHigh"]);
    const headers = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent);
    expect(headers).toEqual(expect.arrayContaining(["KGV", "Dividendenrendite", "Abstand zum 52-Wochen-Hoch"]));
    const lines = [...container.querySelectorAll("[data-key-figures]")].map((line) => line.textContent);
    expect(lines).toEqual([
      "KGV – · Dividendenrendite – · Abstand zum Hoch –",
      "KGV 30,43 · Dividendenrendite 1,18\u00a0% · Abstand zum Hoch -5,20\u00a0%",
    ]);
  });

  it("'Analysten' (story 9.7): menu entry, desktop cell 'Optimistisch (31)' or '–', phone caption; remembered", async () => {
    document.cookie = "dm_watchlist_columns=; max-age=0; path=/";
    const user = userEvent.setup({ delay: null });
    const { table, container } = renderTable([SAP, BTC]);
    await user.click(screen.getByRole("button", { name: "Spalten" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Analysten" }));
    expect([...table.querySelectorAll("thead th")].map((cell) => cell.textContent)).toContain("Analysten");
    expect(document.cookie).toContain("dm_watchlist_columns=analysts");
    const cells = (name: string) =>
      [...([...table.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes(name))?.querySelectorAll("td") ?? [])].map(
        (cell) => cell.textContent,
      );
    expect(cells("SAP SE")).toContain("Optimistisch (31)");
    expect(cells("Bitcoin")).toContain("–");
    expect([...container.querySelectorAll("[data-key-figures]")].map((line) => line.textContent)).toEqual([
      "Analysten –",
      "Analysten Optimistisch (31)",
    ]);
    // Not sortable: the header is plain text, no sort button.
    expect(within(table).queryByRole("button", { name: "Analysten" })).toBeNull();
  });
});
