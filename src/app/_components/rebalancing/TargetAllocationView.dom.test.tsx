// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import { rebalancing, type RebalancingInput, SEGMENTS, type Targets } from "@/core/rebalancing";
import { TargetAllocationView } from "./TargetAllocationView";

vi.mock("@/app/_actions/rebalancing", () => ({ setTargetAllocationAction: vi.fn() }));

registerDomCleanup();

const TODAY = "2026-10-27";

function targets(percent: Partial<Targets>): Targets {
  return Object.fromEntries(SEGMENTS.map((segment) => [segment, percent[segment] ?? "0"])) as Targets;
}

/** A World ETF (split 72/15/6/4/3), a US stock, a bond ETF and cash 200 € in Depot d1. */
function input(allocation: RebalancingInput["targets"], deposit = "0"): RebalancingInput {
  return {
    holdings: [
      {
        securityId: "world",
        depotId: "d1",
        quantity: "10",
        price: "100",
        value: "1000",
        classification: { type: "ETF", assetClass: "Aktien", region: "Welt", country: null },
        split: [
          { region: "USA", weight: "72" },
          { region: "Europa", weight: "15" },
          { region: "Japan", weight: "6" },
          { region: "Pazifik ohne Japan", weight: "4" },
          { region: "Sonstige", weight: "3" },
        ],
      },
      { securityId: "us", depotId: "d1", quantity: "10", price: "50", value: "500", classification: { type: "STOCK", assetClass: "Aktien", region: "USA", country: "USA" }, split: null },
      { securityId: "bond", depotId: "d1", quantity: "10", price: "30", value: "300", classification: { type: "ETF", assetClass: "Anleihen", region: "Welt", country: null }, split: null },
    ],
    cash: [{ depotId: "d1", value: "200" }],
    targets: allocation,
    deposit,
    tax: {
      depots: [
        {
          depotId: "d1",
          broker: "COMDIRECT",
          rows: [
            { securityId: "world", type: "BUY", date: "2026-01-02", sequence: 1, quantity: "10", amount: "800", fee: "0", tax: "0" },
            { securityId: "us", type: "BUY", date: "2026-01-02", sequence: 2, quantity: "10", amount: "300", fee: "0", tax: "0" },
            { securityId: "bond", type: "BUY", date: "2026-01-02", sequence: 3, quantity: "10", amount: "300", fee: "0", tax: "0" },
          ],
        },
      ],
      actions: NO_CORPORATE_ACTIONS,
      securities: { us: { category: "stock", teilfreistellung: "0" }, world: { category: "fund", teilfreistellung: "0.3" } },
      allowances: [],
    },
    today: TODAY,
  };
}

const NAMES = { world: "Welt ETF", us: "US Stock", bond: "Anleihen ETF" };
const DEPOTS = { d1: "Hauptdepot" };

function renderView(allocation: RebalancingInput["targets"], deposit = "0", depositText = "", depositInvalid = false) {
  return render(
    <TargetAllocationView
      scope="portfolio"
      result={rebalancing(input(allocation, deposit))}
      allocation={allocation}
      securityNames={NAMES}
      depotNames={DEPOTS}
      depositText={depositText}
      depositInvalid={depositInvalid}
    />,
  );
}

const rowText = (table: HTMLElement, name: string) =>
  within(table)
    .getByRole("rowheader", { name: new RegExp(`^${name}`) })
    .closest("tr")!
    .textContent!.replace(/\u00a0/g, " ");

describe("TargetAllocationView", () => {
  it("shows actual values, Nicht zugeordnet and the Summe without targets", () => {
    renderView(null);
    const table = screen.getByRole("table", { name: "Ist und Ziel" });
    expect(rowText(table, "Aktien USA")).toBe("Aktien USA1.220,00 €61,9 %–––");
    expect(rowText(table, "Geldmarkt/Cash")).toBe("Geldmarkt/Cash200,00 €10,2 %–––");
    expect(rowText(table, "Nicht zugeordnet")).toContain("Welt ETF (Hauptdepot): 30,00 €");
    expect(rowText(table, "Summe")).toBe("Summe2.000,00 €");
    expect(screen.getByText("Noch keine Zielallokation gespeichert.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Berechnen" })).toBeNull();
  });

  it("shows targets, deviations, 'im Rahmen' and the proposal with sells, buys and totals", () => {
    const allocation = { targets: targets({ equityUsa: "50", equityEurope: "10", equityJapan: "3", equityPacificExJapan: "2", bonds: "15", cash: "20" }), threshold: "2" };
    renderView(allocation, "30", "30");
    const table = screen.getByRole("table", { name: "Ist und Ziel" });
    // A = 1.970: USA 61,93 % vs 50 % → +11,93 Pp., +235,00 €.
    expect(rowText(table, "Aktien USA")).toBe("Aktien USA1.220,00 €61,9 %50 %+11,93 Pp.+235,00 €");
    expect(rowText(table, "Aktien Japan")).toContain("im Rahmen");
    expect(rowText(table, "Aktien USA")).not.toContain("im Rahmen");

    expect((screen.getByRole("textbox", { name: "Neue Einzahlung (€)" }) as HTMLInputElement).value).toBe("30");
    expect(screen.getByRole("button", { name: "Berechnen" })).toBeTruthy();
    const sells = screen.getByRole("table", { name: "Verkäufe" });
    expect(within(sells).getAllByRole("row")[1].textContent).toMatch(/^Aktien USAWelt ETFHauptdepot/);
    expect(within(sells).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Segment",
      "Wertpapier",
      "Depot",
      "Stück",
      "Betrag",
      "geschätzter Gewinn",
      "geschätzte Steuer",
    ]);
    const buys = screen.getByRole("table", { name: "Käufe" });
    expect(rowText(buys, "Geldmarkt/Cash")).toBe("Geldmarkt/Cash200,00 €Als Guthaben halten");
    // The World ETF is sold for USA and suggested for Europa: hint to net the two.
    expect(rowText(buys, "Aktien Europa")).toBe("Aktien Europa50,00 €Welt ETFWird in diesem Vorschlag auch verkauft – Kauf und Verkauf gegeneinander aufrechnen.");
    expect(screen.getByText("geschätzte Steuer gesamt")).toBeTruthy();
    expect(screen.getByText("Saldo Guthaben")).toBeTruthy();
    expect(screen.getByText(/^Vorschlag – es wird nichts gebucht\./)).toBeTruthy();
  });

  it("shows the invalid deposit hint", () => {
    renderView({ targets: targets({ cash: "100" }), threshold: "2" }, "0", "abc", true);
    expect(screen.getByText("Ungültiger Betrag")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Neue Einzahlung (€)" }).getAttribute("aria-invalid")).toBe("true");
  });
});
