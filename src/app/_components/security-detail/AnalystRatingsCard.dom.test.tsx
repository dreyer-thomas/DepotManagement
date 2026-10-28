// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { AnalystRatings } from "@/core/analyst-ratings";
import { emptyKeyFigures } from "@/core/key-figures";
import type { KeyFiguresSnapshot } from "@/modules/classification";
import { theme } from "@/theme/theme";
import { AnalystRatingsCard } from "./AnalystRatingsCard";

vi.mock("@/app/_actions/key-figures", () => ({ refreshKeyFiguresAction: vi.fn() }));

registerDomCleanup();

const NBSP = " ";

const SAP: AnalystRatings = {
  trend: [
    { period: "-3m", strongBuy: 9, buy: 18, hold: 16, sell: 3, strongSell: 1 },
    { period: "-2m", strongBuy: 10, buy: 19, hold: 15, sell: 2, strongSell: 1 },
    { period: "-1m", strongBuy: 10, buy: 21, hold: 14, sell: 2, strongSell: 1 },
    { period: "0m", strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 },
  ],
  analystCount: 51,
  consensusMean: "1.85",
  target: { low: "200", mean: "270", median: "272.5", high: "310", currentPrice: "240", currency: "EUR" },
  changes: [
    {
      date: "2026-10-21",
      firm: "Synthetic Securities",
      fromGrade: "Buy",
      toGrade: "Hold",
      action: "down",
      priceTargetFrom: "250",
      priceTargetTo: "270",
    },
    { date: "2026-10-02", firm: "Demo Capital", fromGrade: null, toGrade: "Overweight", action: "main", priceTargetFrom: null, priceTargetTo: null },
  ],
};

function snapshot(overrides: Partial<KeyFiguresSnapshot> = {}): KeyFiguresSnapshot {
  return {
    symbol: "SAP.DE",
    figures: emptyKeyFigures(),
    fetchedAt: "2026-10-28T09:00:00.000Z",
    asOf: "2026-10-28",
    stale: false,
    fetchedToday: true,
    analystSymbol: "SAP.DE",
    analysts: SAP,
    ...overrides,
  };
}

function renderCard(value: KeyFiguresSnapshot = snapshot()) {
  return render(
    <ThemeProvider theme={theme}>
      <AnalystRatingsCard snapshot={value} />
    </ThemeProvider>,
  );
}

describe("AnalystRatingsCard", () => {
  it("shows consensus, chart labels, trend, Kursziel, source and hint", () => {
    renderCard();
    const card = screen.getByRole("region", { name: "Analystenbewertungen" });
    expect(within(card).getByText("Optimistisch · 51 Analysten")).toBeTruthy();
    expect(within(card).getByText("Kaufen 20+11")).toBeTruthy();
    expect(within(card).getByText("Halten 14")).toBeTruthy();
    expect(within(card).getByText("Verkaufen 3+1")).toBeTruthy();
    expect(within(card).getByText("Ø 270,00 €")).toBeTruthy();
    expect(within(card).getByText("Spanne 200,00 – 310,00 €")).toBeTruthy();
    expect(card.querySelector("[data-target-change]")?.textContent).toBe(`+12,50${NBSP}%`);
    expect(within(card).getByText("Yahoo Finance, Stand 28.10.2026")).toBeTruthy();
    expect(card.textContent).not.toContain("Daten von");
    expect(within(card).getByText("Einschätzungen von Analysten, keine Anlageberatung")).toBeTruthy();
  });

  it("draws an aria-hidden donut with three sectors and darker strong bands", () => {
    renderCard();
    const donut = document.querySelector("[data-analyst-donut]")!;
    expect(donut.getAttribute("aria-hidden")).toBe("true");
    expect([...donut.querySelectorAll("[data-sector]")].map((sector) => sector.getAttribute("data-sector"))).toEqual(["buy", "hold", "sell"]);
    expect(donut.querySelectorAll("[data-sector='buy'] [data-strong]")).toHaveLength(1);
    expect(donut.querySelectorAll("[data-sector='hold'] [data-strong]")).toHaveLength(0);
    expect(donut.querySelectorAll("[data-sector='sell'] [data-strong]")).toHaveLength(1);
  });

  it("offers the current month as a table for screen readers", () => {
    renderCard();
    const table = screen.getByRole("table", { name: "Analystenbewertungen aktuell" });
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Bewertung", "Stark", "Normal", "Anteil"],
      ["Kaufen", "11", "20", `63,3${NBSP}%`],
      ["Halten", "–", "14", `28,6${NBSP}%`],
      ["Verkaufen", "1", "3", `8,2${NBSP}%`],
    ]);
  });

  it("shows four labelled trend columns, oldest first", () => {
    renderCard();
    const columns = screen.getAllByRole("img");
    expect(columns.map((column) => column.getAttribute("aria-label"))).toEqual([
      "vor 3 Monaten: Stark kaufen 9, Kaufen 18, Halten 16, Verkaufen 3, Stark verkaufen 1",
      "vor 2 Monaten: Stark kaufen 10, Kaufen 19, Halten 15, Verkaufen 2, Stark verkaufen 1",
      "vor 1 Monat: Stark kaufen 10, Kaufen 21, Halten 14, Verkaufen 2, Stark verkaufen 1",
      "aktuell: Stark kaufen 11, Kaufen 20, Halten 14, Verkaufen 3, Stark verkaufen 1",
    ]);
    expect(screen.getByText("vor 3 Monaten")).toBeTruthy();
    expect(screen.getByText("aktuell")).toBeTruthy();
  });

  it("collapses 'Letzte Änderungen' behind a button", async () => {
    const user = userEvent.setup({ delay: null });
    renderCard();
    const button = screen.getByRole("button", { name: "Letzte Änderungen" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("21.10.2026 · Synthetic Securities · Buy → Hold · Kursziel 250 → 270")).toBeNull();
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "21.10.2026 · Synthetic Securities · Buy → Hold · Kursziel 250 → 270",
      "02.10.2026 · Demo Capital · Overweight",
    ]);
  });

  it("foreign listing: Kursziel in USD, change vs the same listing, 'Daten von AAPL', stale pill", () => {
    renderCard(
      snapshot({
        symbol: "APC.DE",
        analystSymbol: "AAPL",
        stale: true,
        asOf: "2026-10-10",
        analysts: {
          ...SAP,
          analystCount: null,
          consensusMean: "3.2",
          changes: [],
          target: { low: "180", mean: "245", median: null, high: "300", currentPrice: "250", currency: "USD" },
        },
      }),
    );
    const card = screen.getByRole("region", { name: "Analystenbewertungen" });
    expect(within(card).getByText("Pessimistisch · 49 Analysten")).toBeTruthy();
    expect(within(card).getByText("Ø 245,00 USD")).toBeTruthy();
    expect(within(card).getByText("Spanne 180,00 – 300,00 USD")).toBeTruthy();
    expect(card.querySelector("[data-target-change]")?.textContent).toBe(`-2,00${NBSP}%`);
    expect(card.textContent).toContain("zum aktuellen Kurs (USD)");
    expect(card.textContent).toContain("· Daten von AAPL");
    expect(card.querySelector("[data-stale-badge]")?.textContent).toBe("Stand 10.10.2026 – veraltet");
    expect(within(card).queryByRole("button", { name: "Letzte Änderungen" })).toBeNull();
  });

  it("fresh snapshot from another listing: 'Daten von AAPL' after the date; same listing in other case: no suffix", () => {
    const { unmount } = renderCard(snapshot({ symbol: "APC.DE", analystSymbol: "AAPL" }));
    expect(screen.getByText("Yahoo Finance, Stand 28.10.2026 · Daten von AAPL")).toBeTruthy();
    unmount();
    renderCard(snapshot({ symbol: "sap.de", analystSymbol: "SAP.DE" }));
    expect(screen.getByRole("region", { name: "Analystenbewertungen" }).textContent).not.toContain("Daten von");
  });

  it("shows '–' for the range unless both ends are delivered", () => {
    const { unmount } = renderCard(snapshot({ analysts: { ...SAP, target: { ...SAP.target, high: null } } }));
    expect(screen.getByText("Spanne –")).toBeTruthy();
    unmount();
    renderCard(snapshot({ analysts: { ...SAP, target: { ...SAP.target, low: null } } }));
    expect(screen.getByText("Spanne –")).toBeTruthy();
  });

  it("strong counts zero and a missing current price: 'Kaufen 20+0', change '–'", () => {
    renderCard(
      snapshot({
        analysts: {
          ...SAP,
          trend: [{ period: "0m", strongBuy: 0, buy: 20, hold: 0, sell: 0, strongSell: 0 }],
          target: { ...SAP.target, currentPrice: null },
        },
      }),
    );
    expect(screen.getByText("Kaufen 20+0")).toBeTruthy();
    expect(document.querySelectorAll("[data-strong]")).toHaveLength(0);
    expect(document.querySelector("[data-target-change]")?.textContent).toBe("–");
  });

  it("renders nothing without analyst data", () => {
    const { container } = renderCard(snapshot({ analysts: null }));
    expect(container.textContent).toBe("");
  });
});
