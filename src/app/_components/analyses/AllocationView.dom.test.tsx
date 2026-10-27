// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { type AllocationHolding, allocation } from "@/core/allocation";
import { theme } from "@/theme/theme";
import { securityHref } from "../security-detail/labels";
import { AllocationView, type AllocationViewProps } from "./AllocationView";
import { ALLOCATION_LABELS } from "./labels";

registerDomCleanup();

const NBSP = " ";

const HOLDINGS: AllocationHolding[] = [
  { securityId: "sap", securityName: "SAP SE", assetType: "STOCK", depotId: "a", depotName: "Hauptdepot", value: "400", group: "Technologie" },
  { securityId: "sap", securityName: "SAP SE", assetType: "STOCK", depotId: "b", depotName: "Zweitdepot", value: "200", group: "Technologie" },
  { securityId: "etf", securityName: "Welt ETF", assetType: "ETF", depotId: "a", depotName: "Hauptdepot", value: "300", group: null },
];

function props(overrides: Partial<AllocationViewProps> = {}, cash = "100"): AllocationViewProps {
  const result = allocation(HOLDINGS, cash, ALLOCATION_LABELS);
  return { scope: "portfolio", dimensionLabel: "Sektor", segments: result.segments, positions: result.positions, showDepot: true, ...overrides };
}

function renderView(p: AllocationViewProps = props()) {
  const view = render(
    <ThemeProvider theme={theme}>
      <AllocationView {...p} />
    </ThemeProvider>,
  );
  return {
    ...view,
    rerenderView: (next: AllocationViewProps) =>
      view.rerender(
        <ThemeProvider theme={theme}>
          <AllocationView {...next} />
        </ThemeProvider>,
      ),
  };
}

const legendRows = () => within(screen.getByRole("list", { name: "Legende" })).getAllByRole("button");

describe("AllocationView", () => {
  it("shows the heading, the donut text alternative and each segment with label, share and amount", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Aufteilung nach Sektor" })).toBeTruthy();
    expect(legendRows().map((row) => row.textContent)).toEqual([
      `Technologie60,0${NBSP}%600,00${NBSP}€`,
      `Unbekannt30,0${NBSP}%300,00${NBSP}€`,
      `Guthaben10,0${NBSP}%100,00${NBSP}€`,
    ]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      `Aufteilung nach Sektor: Technologie 60,0${NBSP}% (600,00${NBSP}€), Unbekannt 30,0${NBSP}% (300,00${NBSP}€), Guthaben 10,0${NBSP}% (100,00${NBSP}€)`,
    );
  });

  it("lists a tapped segment's Positions with link, Depot, value and share; a second tap deselects", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();
    await user.click(legendRows()[0]);
    expect(legendRows()[0].getAttribute("aria-pressed")).toBe("true");
    const list = screen.getByRole("list", { name: "Positionen: Technologie" });
    const items = within(list).getAllByRole("listitem");
    // Each row starts with the logo initials (no stored logo).
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe(`SSSAP SEHauptdepot400,00${NBSP}€40,0${NBSP}%`);
    expect(items[1].textContent).toBe(`SSSAP SEZweitdepot200,00${NBSP}€20,0${NBSP}%`);
    expect(within(items[1]).getByRole("link", { name: "SAP SE" }).getAttribute("href")).toBe(securityHref("sap", "b"));
    await user.click(legendRows()[0]);
    expect(screen.queryByRole("list", { name: "Positionen: Technologie" })).toBeNull();
  });

  it("hides the Depot name in a Depot scope", async () => {
    const user = userEvent.setup({ delay: null });
    renderView(props({ scope: "a", showDepot: false }));
    await user.click(legendRows()[1]);
    const items = within(screen.getByRole("list", { name: "Positionen: Unbekannt" })).getAllByRole("listitem");
    expect(items[0].textContent).toBe(`WEWelt ETF300,00${NBSP}€30,0${NBSP}%`);
  });

  it("explains that cash has no Positions", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();
    await user.click(legendRows()[2]);
    expect(screen.getByText("Guthaben der Cash-Konten – keine Positionen.")).toBeTruthy();
  });

  it("clears the selection when scope or dimension changes", async () => {
    const user = userEvent.setup({ delay: null });
    const { rerenderView } = renderView();
    await user.click(legendRows()[0]);
    expect(screen.queryByRole("list", { name: "Positionen: Technologie" })).not.toBeNull();
    rerenderView(props({ dimensionLabel: "Region" }));
    expect(screen.queryByRole("list", { name: /Positionen/ })).toBeNull();
    expect(legendRows().every((row) => row.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("lists negative cash without drawing it", () => {
    renderView(props({}, "-100"));
    expect(legendRows().at(-1)?.textContent).toContain("Guthaben");
    expect([...document.querySelectorAll("svg circle")].map((c) => c.getAttribute("data-segment"))).toEqual(["group:Technologie", "unknown"]);
  });

  it("shows the empty text without segments", () => {
    renderView(props({ segments: [], positions: {} }));
    expect(screen.getByText("Keine Werte vorhanden.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
