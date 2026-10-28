// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { refreshKeyFiguresAction } from "@/app/_actions/key-figures";
import { emptyKeyFigures, type FiftyTwoWeekFigures, NO_FIFTY_TWO_WEEK_FIGURES, type ProviderKeyFigures } from "@/core/key-figures";
import type { KeyFiguresSnapshot } from "@/modules/classification";
import { theme } from "@/theme/theme";
import { KeyFiguresCard } from "./KeyFiguresCard";

vi.mock("@/app/_actions/key-figures", () => ({ refreshKeyFiguresAction: vi.fn() }));

registerDomCleanup();

const refresh = vi.mocked(refreshKeyFiguresAction);
beforeEach(() => refresh.mockReset());

const TODAY = "2026-10-28";
const NBSP = " ";

const SAP: ProviderKeyFigures = {
  ...emptyKeyFigures(),
  trailingPE: "30.4321",
  forwardPE: "24.1",
  priceToBook: "6.5432",
  priceToSales: "6.789",
  pegRatio: "1.87",
  marketCap: "243770000000",
  marketCapCurrency: "EUR",
  revenue: "35900000000",
  revenueCurrency: "EUR",
  dividendYield: "0.0118",
  payoutRatio: "0.4512",
  exDividendDate: "2026-05-15",
  profitMargin: "0.1987",
  returnOnEquity: "0.1534",
  revenueGrowth: "0.091",
  debtToEquity: "22.789",
  beta: "0.987",
  nextEarningsDate: "2027-01-28",
};

const FIFTY_TWO: FiftyTwoWeekFigures = {
  high: { price: "283.5", date: "2026-02-10" },
  low: { price: "190.1", date: "2026-06-03" },
  distanceToHigh: "-0.052",
  performance: "0.1234",
};

function snapshot(figures: ProviderKeyFigures, overrides: Partial<KeyFiguresSnapshot> = {}): KeyFiguresSnapshot {
  return { symbol: "SAP.DE", figures, fetchedAt: "2026-10-28T09:00:00.000Z", asOf: TODAY, stale: false, fetchedToday: true, ...overrides };
}

function renderCard(props: Partial<Parameters<typeof KeyFiguresCard>[0]> = {}) {
  render(
    <ThemeProvider theme={theme}>
      <KeyFiguresCard
        securityId="s1"
        assetType="STOCK"
        snapshot={snapshot(SAP)}
        fiftyTwoWeek={FIFTY_TWO}
        canRefresh
        today={TODAY}
        {...props}
      />
    </ThemeProvider>,
  );
  return screen.getByRole("region", { name: "Kennzahlen" });
}

/** "label value" per dt/dd pair of a group. */
function pairs(card: HTMLElement, group: string): string[] {
  const section = within(card).getByRole("region", { name: group });
  return [...section.querySelectorAll("dt")].map((dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`);
}

describe("KeyFiguresCard", () => {
  it("German stock: source and date, every stock group, 52-week figures and the hint", () => {
    const card = renderCard({ snapshot: snapshot(SAP, { fetchedToday: false }) });
    expect(card.textContent).toContain("Yahoo Finance, Stand 28.10.2026");
    expect(card.querySelector("[data-stale-badge]")).toBeNull();
    expect(pairs(card, "Bewertung")).toEqual(["KGV 30,43", "KGV erwartet 24,10", "KBV 6,54", "KUV 6,79", "PEG 1,87"]);
    expect(pairs(card, "Größe")).toEqual([`Marktkapitalisierung 243,77${NBSP}Mrd.${NBSP}€`, `Umsatz (12 Monate) 35,90${NBSP}Mrd.${NBSP}€`]);
    expect(pairs(card, "Dividende")).toEqual([`Dividendenrendite 1,18${NBSP}%`, `Ausschüttungsquote 45,12${NBSP}%`, "letzter Ex-Tag 15.05.2026"]);
    expect(pairs(card, "Qualität")).toEqual([
      `Nettomarge 19,87${NBSP}%`,
      `Eigenkapitalrendite 15,34${NBSP}%`,
      `Umsatzwachstum 9,10${NBSP}%`,
      `Verschuldungsgrad 22,79${NBSP}%`,
    ]);
    expect(pairs(card, "Risiko")).toEqual(["Beta 0,99"]);
    expect(pairs(card, "Termine")).toEqual(["nächste Quartalszahlen 28.01.2027"]);
    expect(pairs(card, "Kurs · 52 Wochen")).toEqual([
      `52-Wochen-Hoch 283,50${NBSP}€ (10.02.2026)`,
      `52-Wochen-Tief 190,10${NBSP}€ (03.06.2026)`,
      `Abstand zum 52-Wochen-Hoch -5,20${NBSP}%`,
      `Performance 52 Wochen +12,34${NBSP}%`,
    ]);
    expect(card.textContent).toContain("auf Schlusskursbasis");
    expect(card.textContent).toContain("Angaben ohne Gewähr, keine Anlageberatung");
    expect(within(card).getByRole("button", { name: "Kennzahlen aktualisieren" })).toBeDefined();
    expect(card.querySelectorAll("dl").length).toBe(7);
  });

  it("foreign stock on a DE listing: missing figures show '–', revenue in its own currency", () => {
    const apple = { ...SAP, forwardPE: null, revenue: "466820000000", revenueCurrency: "USD", nextEarningsDate: "2026-10-27" };
    const card = renderCard({ snapshot: snapshot(apple) });
    expect(pairs(card, "Bewertung")).toContain("KGV erwartet –");
    expect(pairs(card, "Größe")).toContain(`Umsatz (12 Monate) 466,82${NBSP}Mrd.${NBSP}USD`);
    // The next earnings date lies in the past.
    expect(pairs(card, "Termine")).toEqual(["nächste Quartalszahlen –"]);
  });

  it("ETF: fund figures only, no stock groups", () => {
    const etf = { ...emptyKeyFigures(), fundFamily: "iShares", expenseRatio: "0.002", inceptionDate: "2009-09-25" };
    const card = renderCard({ assetType: "ETF", snapshot: snapshot(etf) });
    expect(pairs(card, "Fonds")).toEqual(["Fondsgesellschaft iShares", `laufende Kosten (TER) 0,20${NBSP}%`, "Auflagedatum 25.09.2009"]);
    expect(within(card).queryByRole("region", { name: "Bewertung" })).toBeNull();
  });

  it("crypto: only the 52-week figures, no source line and no button", () => {
    const card = renderCard({ assetType: "CRYPTO", snapshot: null, canRefresh: false, fiftyTwoWeek: NO_FIFTY_TWO_WEEK_FIGURES });
    expect(card.textContent).not.toContain("Yahoo Finance");
    expect(within(card).queryByRole("region", { name: "Bewertung" })).toBeNull();
    expect(pairs(card, "Kurs · 52 Wochen")).toEqual([
      "52-Wochen-Hoch –",
      "52-Wochen-Tief –",
      "Abstand zum 52-Wochen-Hoch –",
      "Performance 52 Wochen –",
    ]);
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("without a snapshot: 'Noch keine Daten von Yahoo Finance' and the button", () => {
    const card = renderCard({ snapshot: null });
    expect(card.textContent).toContain("Noch keine Daten von Yahoo Finance");
    expect(within(card).queryByRole("region", { name: "Bewertung" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Kennzahlen aktualisieren" })).toBeDefined();
  });

  it("a stale snapshot shows the warning pill", () => {
    const card = renderCard({ snapshot: snapshot(SAP, { asOf: "2026-10-20", stale: true, fetchedToday: false }) });
    expect(card.querySelector("[data-stale-badge]")?.textContent).toBe("Stand 20.10.2026 – veraltet");
    expect(card.textContent).toContain("Yahoo Finance, Stand 20.10.2026 – veraltet");
  });

  it("a snapshot from today disables the button", () => {
    const card = renderCard();
    const button = within(card).getByRole("button", { name: "Heute schon aktualisiert" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("runs the action and shows its message", async () => {
    refresh.mockResolvedValue({ ok: true, status: "failed", message: "Die Kennzahlen konnten gerade nicht geladen werden." });
    const user = userEvent.setup({ delay: null });
    const card = renderCard({ snapshot: null });
    await user.click(within(card).getByRole("button", { name: "Kennzahlen aktualisieren" }));
    expect(refresh).toHaveBeenCalledWith("s1");
    expect((await within(card).findByRole("status")).textContent).toBe("Die Kennzahlen konnten gerade nicht geladen werden.");
  });

  it("hides the button when the Security cannot be refreshed", () => {
    const card = renderCard({ canRefresh: false });
    expect(within(card).queryByRole("button")).toBeNull();
  });
});
