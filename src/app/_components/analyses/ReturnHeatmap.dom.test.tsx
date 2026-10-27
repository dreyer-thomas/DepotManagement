// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { HeatmapMonth, HeatmapYear } from "@/core/return-heatmap";
import { theme } from "@/theme/theme";
import { ReturnHeatmap, type ReturnHeatmapProps } from "./ReturnHeatmap";

registerDomCleanup();

const NBSP = " ";

function month(key: string, ratio: string | null, overrides: Partial<HeatmapMonth> = {}): HeatmapMonth {
  return {
    month: key,
    from: `${key}-01`,
    to: `${key}-28`,
    startValue: "1000",
    endValue: "1100",
    return: ratio,
    netExternalFlows: "0",
    transactions: 0,
    running: false,
    ...overrides,
  };
}

const YEARS: HeatmapYear[] = [
  {
    year: 2026,
    months: [
      month("2026-01", "0.1", { from: "2026-01-15", to: "2026-01-31", startValue: "0", endValue: "1100", netExternalFlows: "1000", transactions: 2 }),
      month("2026-02", "-0.1", { startValue: "1100", endValue: "990" }),
      month("2026-03", "0.0321", { to: "2026-03-27", running: true }),
      ...Array<null>(9).fill(null),
    ],
    quarters: ["0.021", null, null, null],
    total: "0.021",
  },
];

function renderView(props: ReturnHeatmapProps = { scope: "portfolio", years: YEARS }) {
  const view = render(
    <ThemeProvider theme={theme}>
      <ReturnHeatmap {...props} />
    </ThemeProvider>,
  );
  return {
    ...view,
    rerenderView: (next: ReturnHeatmapProps) =>
      view.rerender(
        <ThemeProvider theme={theme}>
          <ReturnHeatmap {...next} />
        </ThemeProvider>,
      ),
  };
}

/** The emitted emotion CSS of the rules targeting `element`'s own classes. */
function cssOf(element: Element): string {
  const css = [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n");
  return [...element.classList]
    .filter((name) => name.startsWith("css-"))
    .flatMap((name) => css.match(new RegExp(`[^}]*\\.${name}[^{]*\\{[^}]*\\}`, "g")) ?? [])
    .join("\n");
}

describe("ReturnHeatmap", () => {
  it("shows years × months with signed returns, quarter and year totals", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Rendite je Monat" })).toBeTruthy();
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Q1", "Q2", "Q3", "Q4", "Jahr"]);
    const [row] = within(table).getAllByRole("row").slice(1);
    expect(within(row).getByRole("rowheader").textContent).toBe("2026");
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      `+10,00${NBSP}%`,
      `-10,00${NBSP}%`,
      `+3,21${NBSP}%laufend`,
      ...Array(9).fill(""),
      `+2,10${NBSP}%`,
      "–",
      "–",
      "–",
      `+2,10${NBSP}%`,
    ]);
    // Only months are buttons; quarter and year totals are not tappable.
    expect(within(table).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: `März 2026: +3,21${NBSP}%, laufend` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Februar 2026: -10,00${NBSP}%` })).toBeTruthy();
  });

  it("toggles the month detail by tapping, also with the keyboard", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();
    const january = screen.getByRole("button", { name: `Januar 2026: +10,00${NBSP}%` });
    await user.click(january);
    expect(january.getAttribute("aria-pressed")).toBe("true");
    const detail = screen.getByRole("region", { name: "Januar 2026" });
    expect(detail.textContent).toContain("15.01.2026 – 31.01.2026");
    const terms = within(detail).getAllByRole("term").map((t) => t.textContent);
    const values = within(detail).getAllByRole("definition").map((d) => d.textContent);
    expect(terms).toEqual(["Startwert", "Endwert", "Rendite", "Externe Zuflüsse (netto)", "Transaktionen"]);
    expect(values).toEqual([`0,00${NBSP}€`, `1.100,00${NBSP}€`, `+10,00${NBSP}%`, `+1.000,00${NBSP}€`, "2"]);
    await user.click(january);
    expect(screen.queryByRole("region", { name: "Januar 2026" })).toBeNull();

    screen.getByRole("button", { name: `Februar 2026: -10,00${NBSP}%` }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Februar 2026" })).toBeTruthy();
  });

  it("resets the selection when the scope changes", async () => {
    const user = userEvent.setup({ delay: null });
    const { rerenderView } = renderView();
    await user.click(screen.getByRole("button", { name: `Februar 2026: -10,00${NBSP}%` }));
    expect(screen.getByRole("region", { name: "Februar 2026" })).toBeTruthy();
    rerenderView({ scope: "d1", years: YEARS });
    expect(screen.queryByRole("region", { name: "Februar 2026" })).toBeNull();
  });

  it("shows – for a month without a return", async () => {
    const user = userEvent.setup({ delay: null });
    const years: HeatmapYear[] = [{ ...YEARS[0], months: [month("2026-01", null, { startValue: "0", endValue: "0", transactions: 1 }), ...Array<null>(11).fill(null)] }];
    renderView({ scope: "portfolio", years });
    await user.click(screen.getByRole("button", { name: "Januar 2026: –" }));
    const detail = screen.getByRole("region", { name: "Januar 2026" });
    expect(within(detail).getAllByRole("definition")[2].textContent).toBe("–");
  });

  it("tints and marks gain cells green with an up arrow, loss cells red with a down arrow, empty ones not", () => {
    const years: HeatmapYear[] = [
      { ...YEARS[0], months: [month("2026-01", "0.1"), month("2026-02", "-0.1"), month("2026-03", null), ...Array<null>(9).fill(null)] },
    ];
    renderView({ scope: "portfolio", years });
    const cell = (name: string) => screen.getByRole("button", { name }).closest("td")!;
    const gain = cell(`Januar 2026: +10,00${NBSP}%`);
    const loss = cell(`Februar 2026: -10,00${NBSP}%`);
    const none = cell("März 2026: –");
    expect(cssOf(gain)).toContain("--mui-palette-gain-main");
    expect(cssOf(gain)).not.toContain("--mui-palette-loss-main");
    expect(cssOf(loss)).toContain("--mui-palette-loss-main");
    expect(cssOf(loss)).not.toContain("--mui-palette-gain-main");
    expect(cssOf(none)).not.toMatch(/--mui-palette-(gain|loss)-main/);
    const arrows = (td: Element) => [...td.querySelectorAll("svg")].map((svg) => [svg.getAttribute("data-testid"), svg.getAttribute("aria-hidden")]);
    expect(arrows(gain)).toEqual([["ArrowUpwardIcon", "true"]]);
    expect(arrows(loss)).toEqual([["ArrowDownwardIcon", "true"]]);
    expect(arrows(none)).toEqual([]);
  });

  it("shows the empty text without Transactions", () => {
    renderView({ scope: "portfolio", years: [] });
    expect(screen.getByText("Noch keine Transaktionen.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
