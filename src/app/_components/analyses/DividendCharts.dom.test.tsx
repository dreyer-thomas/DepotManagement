// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { DividendStackedChart } from "./DividendStackedChart";
import { DividendYearLinesChart } from "./DividendYearLinesChart";

registerDomCleanup();

const NBSP = " ";

// happy-dom has no layout: give the chart container a size through its computed style.
const realGetComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
    const style = realGetComputedStyle(element, pseudo);
    return new Proxy(style, {
      get(target, key) {
        if (key === "width") return "600px";
        if (key === "height") return "240px";
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SPLITS = [
  { period: "2026-02", securities: [] },
  {
    period: "2026-03",
    securities: [
      { securityId: "x", gross: "10", net: "8" },
      { securityId: "y", gross: "5", net: "5" },
    ],
  },
];
const BUCKETS = [
  { period: "2026-02", gross: "0", net: "0" },
  { period: "2026-03", gross: "15", net: "13" },
];

function renderStacked(onMonthClick = vi.fn()) {
  const view = render(
    <ThemeProvider theme={theme}>
      <DividendStackedChart
        ariaLabel="Dividenden pro Monat"
        categories={["Feb", "Mär"]}
        buckets={BUCKETS}
        splits={SPLITS}
        securityIds={["x", "y"]}
        colorOf={(id) => (id === "x" ? "#0FA68A" : "#5BC8F5")}
        name={(id) => (id === "x" ? "SAP SE" : "Yolo AG")}
        mode="gross"
        onMonthClick={onMonthClick}
      />
    </ThemeProvider>,
  );
  return { ...view, onMonthClick };
}

async function tooltipText(expected: string): Promise<string> {
  return waitFor(() => {
    const text = document.querySelector("[role='tooltip']")?.textContent ?? "";
    if (!text.includes(expected)) throw new Error(`no tooltip yet: ${text}`);
    return text;
  });
}

describe("dividend charts (real rendering)", () => {
  it("shows the segment tooltip with name, amount and month total on arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderStacked();
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    const text = await tooltipText("Summe");
    expect(text).toContain("SAP SE");
    expect(text).toContain(`10,00${NBSP}€`);
    expect(text).toContain(`Summe März 2026: 15,00${NBSP}€`);
  });

  it("reports the activated month band (pointer tap)", async () => {
    const user = userEvent.setup({ delay: null });
    const { container, onMonthClick } = renderStacked();
    const svg = await waitFor(() => {
      const element = container.querySelector("svg");
      if (!element?.querySelector(".MuiBarChart-element")) throw new Error("not drawn yet");
      return element;
    });
    // Chart area x 80..592 (two bands); the second band (März) is to the right.
    await user.pointer([{ target: svg, coords: { clientX: 450, clientY: 100 }, keys: "[MouseLeft]" }]);
    await waitFor(() => expect(onMonthClick).toHaveBeenCalledWith(1));
  });

  it("renders stacked bars with the total label and dimmed segments", async () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <DividendStackedChart
          ariaLabel="Dividenden pro Monat"
          categories={["Feb", "Mär"]}
          buckets={BUCKETS}
          splits={SPLITS}
          securityIds={["x", "y"]}
          colorOf={(id) => (id === "x" ? "#0FA68A" : "#5BC8F5")}
          name={(id) => (id === "x" ? "SAP SE" : "Yolo AG")}
          mode="gross"
          chosen="x"
          onMonthClick={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("figure", { name: "Dividenden pro Monat" })).toBeTruthy();
    await waitFor(() => expect(container.textContent).toContain(`15,00${NBSP}€`));
    const bars = [...container.querySelectorAll("rect, path")].filter((element) => element.getAttribute("fill-opacity") === "0.25");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("renders the year lines with a legend and the forecast", async () => {
    const zero = { gross: "0", net: "0" };
    const { container } = render(
      <ThemeProvider theme={theme}>
        <DividendYearLinesChart
          ariaLabel="Dividenden akkumuliert pro Jahr"
          lines={[
            { year: "2025", points: Array(12).fill(zero) },
            { year: "2026", points: [...Array(10).fill({ gross: "40", net: "30" }), null, null] },
          ]}
          forecast={[...Array(9).fill(null), { gross: "40", net: "30" }, { gross: "80", net: "59" }, { gross: "80", net: "59" }]}
          today="2026-10-27"
          mode="gross"
          colorOf={(index) => ["#0FA68A", "#5BC8F5", "#FFB547"][index]}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("figure", { name: "Dividenden akkumuliert pro Jahr" })).toBeTruthy();
    await waitFor(() => expect(container.textContent).toContain("Prognose 2026 (Schätzung)"));
    expect(container.textContent).toContain("2025");
    await waitFor(() => expect(container.querySelector('.MuiLineChart-line[data-series="forecast"]')).not.toBeNull());
    expect(container.querySelector('.MuiLineChart-line[data-series="year-2026"]')).not.toBeNull();
    expect(container.querySelector('.MuiLineChart-line[data-series="year-2025"]')).not.toBeNull();
  });

  it("draws no forecast line when the forecast is off", async () => {
    const zero = { gross: "0", net: "0" };
    const { container } = render(
      <ThemeProvider theme={theme}>
        <DividendYearLinesChart
          ariaLabel="Dividenden akkumuliert pro Jahr"
          lines={[{ year: "2026", points: [...Array(10).fill(zero), null, null] }]}
          forecast={null}
          today="2026-10-27"
          mode="gross"
          colorOf={() => "#0FA68A"}
        />
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.querySelector('.MuiLineChart-line[data-series="year-2026"]')).not.toBeNull());
    expect(container.querySelector('.MuiLineChart-line[data-series="forecast"]')).toBeNull();
    expect(container.textContent).not.toContain("Prognose");
  });
});
