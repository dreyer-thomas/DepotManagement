// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { type CompositionHolding, compositionByAssetType, compositionByDepot, compositionByPosition } from "@/core/composition";
import { theme } from "@/theme/theme";
import { CompositionCard, type CompositionViewData } from "./CompositionCard";
import { COMPOSITION_LABELS } from "./labels";

registerDomCleanup();

const NBSP = " ";

const HOLDINGS: CompositionHolding[] = [
  { securityId: "w", securityName: "Welt ETF", assetType: "ETF", depotId: "a", depotName: "Hauptdepot", value: "600" },
  { securityId: "x", securityName: "Apple Inc.", assetType: "STOCK", depotId: "b", depotName: "Zweitdepot", value: "300" },
];

function views(holdings = HOLDINGS, cash = "100", withDepot = true): CompositionViewData[] {
  const all: CompositionViewData[] = [
    { view: "position", segments: compositionByPosition(holdings, cash, COMPOSITION_LABELS) },
    { view: "type", segments: compositionByAssetType(holdings, cash, COMPOSITION_LABELS) },
  ];
  if (withDepot) all.push({ view: "depot", segments: compositionByDepot(holdings, cash, COMPOSITION_LABELS) });
  return all;
}

function renderCard(data: CompositionViewData[] = views()) {
  return render(
    <ThemeProvider theme={theme}>
      <CompositionCard views={data} />
    </ThemeProvider>,
  );
}

const legendRows = () => within(screen.getByRole("list", { name: "Legende" })).getAllByRole("button");
const segments = () => [...document.querySelectorAll("svg circle")];

describe("CompositionCard", () => {
  it("shows the Typ view by default with label, share and amount per legend row", () => {
    renderCard();
    expect(screen.getByRole("region", { name: "Zusammensetzung" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Typ" }).getAttribute("aria-pressed")).toBe("true");
    expect(legendRows().map((row) => row.textContent)).toEqual([
      `ETF60,0${NBSP}%600,00${NBSP}€`,
      `Aktie30,0${NBSP}%300,00${NBSP}€`,
      `Guthaben10,0${NBSP}%100,00${NBSP}€`,
    ]);
  });

  it("gives the donut a text alternative listing every segment", () => {
    renderCard();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      `Zusammensetzung nach Typ: ETF 60,0${NBSP}% (600,00${NBSP}€), Aktie 30,0${NBSP}% (300,00${NBSP}€), Guthaben 10,0${NBSP}% (100,00${NBSP}€)`,
    );
  });

  it("draws cash last in the cash color and the others in series order", () => {
    renderCard();
    const circles = segments();
    expect(circles.map((c) => c.getAttribute("data-segment"))).toEqual(["type:ETF", "type:STOCK", "cash"]);
    // Theme CSS variables, so dark mode follows the color scheme.
    expect(circles.map((c) => c.getAttribute("stroke")?.match(/^var\((--[\w-]+)/)?.[1])).toEqual([
      "--mui-palette-chart-series1",
      "--mui-palette-chart-series2",
      "--mui-palette-cash-main",
    ]);
    expect(circles[0].getAttribute("stroke-dasharray")).toBe("60 40");
    expect(circles[0].getAttribute("stroke-dashoffset")).toBe("25");
    expect(circles[1].getAttribute("stroke-dashoffset")).toBe("-35");
  });

  it("highlights a segment from its legend row and clears it on the second press", async () => {
    const user = userEvent.setup();
    renderCard();
    const aktie = legendRows()[1];
    expect(aktie.getAttribute("aria-pressed")).toBe("false");
    await user.click(aktie);
    expect(aktie.getAttribute("aria-pressed")).toBe("true");
    expect(segments().map((c) => c.getAttribute("data-highlighted"))).toEqual([null, "true", null]);
    expect(segments().map((c) => c.getAttribute("stroke-width"))).toEqual(["6", "8", "6"]);
    expect(segments().map((c) => c.getAttribute("stroke-opacity"))).toEqual(["0.35", "1", "0.35"]);
    await user.click(aktie);
    expect(aktie.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(segments().map((c) => c.getAttribute("stroke-width"))).toEqual(["6", "6", "6"]);
    expect(segments().map((c) => c.getAttribute("stroke-opacity"))).toEqual(["1", "1", "1"]);
  });

  it("activates a legend row by keyboard", async () => {
    const user = userEvent.setup();
    renderCard();
    legendRows()[0].focus();
    await user.keyboard("{Enter}");
    expect(legendRows()[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the view with the toggle and clears the highlight", async () => {
    const user = userEvent.setup();
    renderCard();
    expect(screen.getByRole("group", { name: "Aufteilung" })).toBeDefined();
    await user.click(legendRows()[0]);
    await user.click(screen.getByRole("button", { name: "Depot" }));
    expect(legendRows().map((row) => row.firstElementChild?.nextSibling?.textContent)).toEqual(["Hauptdepot", "Zweitdepot", "Guthaben"]);
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(legendRows().every((row) => row.getAttribute("aria-pressed") === "false")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Position" }));
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/^Zusammensetzung nach Position: Welt ETF 60,0/);
  });

  it("offers no Depot toggle when only Position and Typ are given", () => {
    renderCard(views(HOLDINGS, "100", false));
    expect(screen.getByRole("button", { name: "Position" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Typ" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Depot" })).toBeNull();
  });

  it("does not draw a negative cash segment but lists it", () => {
    renderCard(views(HOLDINGS, "-90"));
    expect(segments().map((c) => c.getAttribute("data-segment"))).toEqual(["type:ETF", "type:STOCK"]);
    expect(legendRows().at(-1)?.textContent).toBe(`Guthaben-11,1${NBSP}%-90,00${NBSP}€`);
    // The drawn ring spans the positive segments only: 600 / 900 and 300 / 900.
    expect(segments().map((c) => c.getAttribute("stroke-dasharray"))).toEqual(["66.6667 33.3333", "33.3333 66.6667"]);
    expect(segments()[1].getAttribute("stroke-dashoffset")).toBe(String(Number((25 - 200 / 3).toFixed(4))));
  });

  it("dims nothing when the undrawn negative Guthaben row is pressed", async () => {
    const user = userEvent.setup();
    renderCard(views(HOLDINGS, "-90"));
    const guthaben = legendRows().at(-1)!;
    await user.click(guthaben);
    expect(guthaben.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(segments().map((c) => c.getAttribute("stroke-opacity"))).toEqual(["1", "1"]);
  });

  it("says Keine Werte vorhanden. without segments", () => {
    renderCard(views([], "0"));
    expect(screen.getByText("Keine Werte vorhanden.")).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
