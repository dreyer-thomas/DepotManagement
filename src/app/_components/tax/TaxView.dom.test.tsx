// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import type { GainsRow } from "@/core/gains-analysis";
import { taxPreview } from "@/core/tax";
import { TaxView } from "./TaxView";

registerDomCleanup();

let sequence = 0;
const row = (type: string, date: string, input: Partial<GainsRow> = {}): GainsRow => ({
  securityId: null,
  type,
  date,
  sequence: ++sequence,
  quantity: null,
  price: null,
  amount: "0",
  fee: "0",
  tax: "0",
  ...input,
});
const trade = (securityId: string, gain: number, date = "2026-03-01"): GainsRow[] => [
  row("BUY", "2025-01-02", { securityId, quantity: "1", amount: "1000" }),
  row("SELL", date, { securityId, quantity: "1", amount: String(1000 + gain) }),
];

/** The spec's full example at comdirect, plus a Deutsche Bank Depot with a dividend only. */
function years() {
  return taxPreview({
    depots: [
      {
        broker: "COMDIRECT",
        rows: [
          ...trade("stockA", 3000),
          ...trade("stockB", -500),
          ...trade("etf", 1000),
          row("DIVIDEND", "2026-05-01", { securityId: "stockA", amount: "200" }),
          row("DIVIDEND", "2026-05-02", { securityId: "etf", amount: "100" }),
          ...trade("cert", -400),
          row("TAX", "2026-06-01", { tax: "600" }),
        ],
      },
      { broker: "DEUTSCHE_BANK", rows: [row("DIVIDEND", "2026-07-01", { securityId: "stockA", amount: "400", tax: "50" })] },
    ],
    actions: NO_CORPORATE_ACTIONS,
    securities: {
      stockA: { category: "stock", teilfreistellung: "0" },
      stockB: { category: "stock", teilfreistellung: "0" },
      etf: { category: "fund", teilfreistellung: "0.3" },
      cert: { category: "other", teilfreistellung: "0" },
    },
    allowances: [
      { broker: "COMDIRECT", year: 2026, amount: "1000" },
      { broker: "DEUTSCHE_BANK", year: 2026, amount: "200" },
    ],
    brokers: ["COMDIRECT", "DEUTSCHE_BANK"],
    today: "2026-10-27",
  });
}

const text = (element: Element) => (element.textContent ?? "").replace(/ /g, " ");

describe("TaxView", () => {
  it("shows the summary per broker and the Portfolio total with labelled differences", () => {
    render(<TaxView years={years()} today="2026-10-27" />);
    const table = screen.getByRole("table", { name: "Steuerschätzung 2026" });
    const rows = within(table).getAllByRole("row").map(text);
    expect(rows).toEqual([
      "BrokerGeschätzte SteuerEinbehaltenDifferenz",
      "comdirect545,96 €+600,00 €voraussichtliche Erstattung 54,04 €",
      "Deutsche Bank52,75 €+50,00 €voraussichtliche Nachbelastung 2,75 €",
      "Portfolio gesamt598,71 €+650,00 €voraussichtliche Erstattung 51,29 €",
    ]);
    expect(screen.getByText(/^Schätzung – maßgeblich ist die Steuerbescheinigung deiner Bank\./)).toBeTruthy();
    expect(screen.getByText(/übersteigt 1\.000 €/)).toBeTruthy();
  });

  it("shows the per-broker breakdown with signed amounts", () => {
    render(<TaxView years={years()} today="2026-10-27" />);
    const card = screen.getByRole("table", { name: "comdirect – Schätzung 2026" });
    const lines = within(card).getAllByRole("row").map(text);
    expect(lines).toEqual([
      "Dividenden und Zinsen270,00 €",
      "Aktien Gewinne / Verluste+3.000,00 € / -500,00 €",
      "Fonds/ETFs nach Teilfreistellung+700,00 €",
      "Sonstige Erträge-400,00 €",
      "Verlustverrechnung",
      "mit Aktiengewinnen verrechnet0,00 €",
      "nicht verrechenbare Aktienverluste0,00 €",
      "nicht verrechenbare sonstige Verluste0,00 €",
      "Steuerpflichtige Erträge3.070,00 €",
      "Freistellungsauftrag genutzt / verbleibend1.000,00 € / 0,00 €",
      "Kapitalertragsteuer 25 %517,50 €",
      "Solidaritätszuschlag 5,5 %28,46 €",
      "Geschätzte Steuer545,96 €",
      "Einbehaltene Steuer (laut Buchungen)+600,00 €",
      "voraussichtliche Erstattung54,04 €",
    ]);
  });

  it("switches the year and hides the allowance hint for a year within the limit", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TaxView years={years()} today="2026-10-27" />);
    await user.click(screen.getByRole("combobox", { name: "Jahr" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["2026", "2025"]);
    await user.click(screen.getByRole("option", { name: "2025" }));
    expect(screen.getByRole("table", { name: "Steuerschätzung 2025" })).toBeTruthy();
    expect(screen.queryByText(/übersteigt 1\.000 €/)).toBeNull();
    expect(text(within(screen.getByRole("table", { name: "Steuerschätzung 2025" })).getAllByRole("row")[1])).toBe("comdirect0,00 €0,00 €keine Abweichung");
  });
});
