// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { saveTransactionAction } from "@/app/_actions/transactions";
import type { SecurityTotal as SecurityTotalFigures } from "@/core/security";
import type { SecuritySummary } from "@/modules/ledger";
import { theme } from "@/theme/theme";
import { DepotSwitcher } from "./DepotSwitcher";
import { PriceLine } from "./PriceLine";
import { SecurityActions } from "./SecurityActions";
import { SecurityChart } from "./SecurityChart";
import { SecurityTotal } from "./SecurityTotal";

vi.mock("@/app/_actions/transactions", () => ({
  saveTransactionAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
}));
vi.mock("@/app/_actions/corporate-actions", () => ({
  saveSplitAction: vi.fn(),
  deleteSplitAction: vi.fn(),
  saveIsinChangeAction: vi.fn(),
  deleteIsinChangeAction: vi.fn(),
}));
vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveTransactionAction);
beforeEach(() => save.mockReset());

const security: SecuritySummary = { id: "s1", name: "Welt ETF", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF" };

describe("DepotSwitcher", () => {
  it("links Alle Depots and each Depot, marking the selected one", () => {
    render(
      <DepotSwitcher
        securityId="s1"
        depots={[
          { id: "a", name: "Alpha", archived: false },
          { id: "b", name: "Beta", archived: true },
        ]}
        selected="b"
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Depot" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Alle Depots", "/securities/s1", null],
      ["Alpha", "/securities/s1?depot=a", null],
      ["Beta (archiviert)", "/securities/s1?depot=b", "page"],
    ]);
  });

  it("omits Alle Depots when every booking Depot is archived", () => {
    render(<DepotSwitcher securityId="s1" depots={[{ id: "b", name: "Beta", archived: true }]} selected="b" />);
    expect(screen.queryByRole("link", { name: "Alle Depots" })).toBeNull();
  });
});

describe("SecurityActions", () => {
  const props = { security, splits: [], isinChanges: [], securities: [security], today: "2026-10-26" };

  it("opens Neue Buchung with the Depot and the Security preselected", async () => {
    save.mockResolvedValue({ ok: false, reason: "quantity-invalid" });
    const user = userEvent.setup({ delay: null });
    render(<SecurityActions {...props} transactionDepots={[{ id: "a", name: "Alpha" }]} />);
    await user.click(screen.getByRole("button", { name: "Aktionen für Welt ETF" }));
    await user.click(await screen.findByRole("menuitem", { name: "Neue Buchung" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((within(dialog).getByRole("combobox", { name: "Security" }) as HTMLInputElement).value).toBe("Welt ETF (IE00B4L5Y983)");
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toMatchObject({ depotId: "a", securityId: "s1" });
  }, 20_000);

  it("asks for the Depot first with several Depots", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <SecurityActions
        {...props}
        transactionDepots={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Aktionen für Welt ETF" }));
    await user.click(await screen.findByRole("menuitem", { name: "Neue Buchung" }));
    const menu = await screen.findByRole("menu", { name: "Depot wählen" });
    await user.click(within(menu).getByRole("menuitem", { name: "Beta" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((dialog.querySelector('input[name="depotId"]') as HTMLInputElement).value).toBe("b");
  }, 20_000);

  it("offers split and ISIN change, and no Neue Buchung without a Depot", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SecurityActions {...props} transactionDepots={[]} />);
    await user.click(screen.getByRole("button", { name: "Aktionen für Welt ETF" }));
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["Split …", "ISIN-Wechsel …"]);
    await user.click(screen.getByRole("menuitem", { name: "Split …" }));
    expect(await screen.findByRole("dialog", { name: "Split – Welt ETF" })).toBeTruthy();
  }, 20_000);
});

describe("PriceLine", () => {
  const price = { price: "100", date: "2026-10-20", source: "provider" as const, fetchedAt: "2026-10-20T18:00:00.000Z", provider: "YAHOO" };

  it("shows a stale price with the hint and the manual price button for a held Security", () => {
    render(<PriceLine price={price} security={security} held today="2026-10-26" />);
    expect(screen.getByText("Kurs vom 20.10.2026 – veraltet")).toBeTruthy();
    expect(screen.getByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kurs manuell eintragen – Welt ETF" })).toBeTruthy();
  });

  it("shows no hint for a sold Security or a current price", () => {
    const { unmount } = render(<PriceLine price={price} security={security} held={false} today="2026-10-26" />);
    expect(screen.queryByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeNull();
    unmount();
    render(<PriceLine price={{ ...price, date: "2026-10-25" }} security={security} held today="2026-10-26" />);
    expect(screen.getByText("Kurs vom 25.10.2026")).toBeTruthy();
    expect(screen.queryByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeNull();
  });

  it("says when there is no price", () => {
    render(<PriceLine price={null} security={security} held today="2026-10-26" />);
    expect(screen.getByText("Kein Kurs vorhanden.")).toBeTruthy();
  });
});

describe("SecurityChart", () => {
  // happy-dom has no layout: give the chart container a size through its computed style.
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  beforeEach(() => {
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
      const style = realGetComputedStyle(element, pseudo);
      return new Proxy(style, {
        get(target, key) {
          if (key === "width") return "600px";
          if (key === "height") return "200px";
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const valuePoints = [
    { date: "2026-10-21", value: "1000", invested: "1000" },
    { date: "2026-10-22", value: "1050", invested: "1000" },
  ];
  const pricePoints = [
    { date: "2026-10-21", price: "100" },
    { date: "2026-10-22", price: "105" },
  ];
  const trades = [{ depotName: "Alpha", type: "BUY" as const, date: "2026-10-21", quantity: "10", price: "100", adjusted: false }];

  it("shows the price chart by default and switches to the value chart", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ThemeProvider theme={theme}>
        <SecurityChart valuePoints={valuePoints} pricePoints={pricePoints} trades={trades} />
      </ThemeProvider>,
    );
    const group = screen.getByRole("group", { name: "Diagramm" });
    const kurs = within(group).getByRole("button", { name: "Kurs" });
    expect(kurs.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/^Kursverlauf 21\.10\.2026 – 22\.10\.2026: .*1 Kauf, 0 Verkäufe$/);

    await user.click(within(group).getByRole("button", { name: "Wert" }));
    expect(within(group).getByRole("button", { name: "Wert" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/^Wertentwicklung 21\.10\.2026/);

    await user.click(kurs);
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/^Kursverlauf/);
  });

  it("shows the no-price text in Kurs mode without any price", () => {
    render(
      <ThemeProvider theme={theme}>
        <SecurityChart valuePoints={valuePoints} pricePoints={pricePoints.map((p) => ({ ...p, price: null }))} trades={[]} />
      </ThemeProvider>,
    );
    expect(screen.getByText("Kein Kursverlauf vorhanden.")).toBeTruthy();
  });
});

describe("SecurityTotal", () => {
  const figures: SecurityTotalFigures = {
    realized: "198",
    unrealized: "-12.5",
    dividends: "20",
    fees: "3",
    taxesPaid: "5",
    total: "202.5",
    totalInvested: "1001",
    returnRatio: "0.2023",
    xirr: "0.1978",
    value: "500",
  };

  function rows(): string[][] {
    const section = screen.getByRole("region", { name: "Gesamt seit Erstkauf" });
    return [...section.querySelectorAll("dt")].map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""]);
  }

  it("lists the all-time figures with signs, taxes and invested separately", () => {
    render(<SecurityTotal total={figures} />);
    expect(screen.getByRole("heading", { name: "Gesamt seit Erstkauf" })).toBeTruthy();
    expect(rows()).toEqual([
      ["Realisiert", "+198,00\u00a0€"],
      ["Unrealisiert", "-12,50\u00a0€"],
      ["Dividenden", "+20,00\u00a0€"],
      ["Gebühren", "-3,00\u00a0€"],
      ["Gesamt", "+202,50\u00a0€"],
      ["Steuern gezahltnicht in Gewinn/Verlust enthalten", "+5,00\u00a0€"],
      ["Investiert gesamt", "1.001,00\u00a0€"],
      ["Rendite auf Investiert", "+20,23\u00a0%"],
      ["XIRR", "+19,78\u00a0%"],
    ]);
    // The return carries an arrow, not color alone.
    expect(screen.getByRole("region", { name: "Gesamt seit Erstkauf" }).querySelector("[data-testid='ArrowUpwardIcon']")).toBeTruthy();
  });

  it("shows – without a value", () => {
    render(<SecurityTotal total={{ ...figures, unrealized: null, total: null, returnRatio: null, xirr: null, value: null }} />);
    const byLabel = Object.fromEntries(rows());
    expect(byLabel["Unrealisiert"]).toBe("–");
    expect(byLabel["Gesamt"]).toBe("–");
    expect(byLabel["Rendite auf Investiert"]).toBe("–");
    expect(byLabel["XIRR"]).toBe("–");
    expect(byLabel["Realisiert"]).toBe("+198,00\u00a0€");
  });
});
