// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import type { ValueChartTab } from "@/app/_components/charts/chart-preference";
import { ValueChartTabs } from "./ValueChartTabs";

registerDomCleanup();

const POINTS = [
  { date: "2026-02-01", value: "110", invested: "100" },
  { date: "2026-02-02", value: "99", invested: "100" },
];
const DRAWDOWN = {
  points: [
    { date: "2026-02-01", drawdown: "0" },
    { date: "2026-02-02", drawdown: "-0.1" },
  ],
  current: "-0.1",
  max: "-0.1",
  phase: { peak: "2026-02-01", end: "2026-02-02", recovered: false, days: 1 },
};

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
  document.cookie = "dm_chart_tab=; path=/; max-age=0";
});

const COMPARISON = {
  scopeLabel: "Portfolio",
  line: [
    { date: "2026-01-31", performance: "0" },
    { date: "2026-02-01", performance: "0.1" },
    { date: "2026-02-02", performance: "-0.01" },
  ],
  ttwror: "-0.01",
  options: [{ key: "msci-world", label: "MSCI World", line: null, ttwror: null }],
  initialChoice: "none",
};

function renderTabs(initialTab: ValueChartTab = "performance", comparison: typeof COMPARISON | null = COMPARISON) {
  return render(
    <ThemeProvider theme={theme}>
      <ValueChartTabs points={POINTS} drawdown={DRAWDOWN} initialTab={initialTab} comparison={comparison ?? undefined} />
    </ThemeProvider>,
  );
}

describe("ValueChartTabs", () => {
  it("shows Wertentwicklung by default and switches to Drawdown in place, storing the tab", async () => {
    const user = userEvent.setup({ delay: null });
    renderTabs();
    expect(screen.getByRole("tab", { name: "Wertentwicklung" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/^Wertentwicklung 01\.02\.2026/);
    expect(screen.queryByText("Maximaler Drawdown")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Drawdown" }));
    expect(screen.getByRole("tab", { name: "Drawdown" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe("Drawdown 01.02.2026 – 02.02.2026: maximaler Drawdown -10,00 %");
    expect(screen.getByText("Maximaler Drawdown")).toBeTruthy();
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Drawdown" }).id);
    expect(document.cookie).toContain("dm_chart_tab=drawdown");

    await user.click(screen.getByRole("tab", { name: "Wertentwicklung" }));
    expect(document.cookie).toContain("dm_chart_tab=performance");
  });

  it("orders the tabs Wertentwicklung, Performance, Drawdown and shows the TTWROR comparison in place", async () => {
    const user = userEvent.setup({ delay: null });
    renderTabs();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Wertentwicklung", "Performance", "Drawdown"]);
    await user.click(screen.getByRole("tab", { name: "Performance" }));
    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe("Performance 31.01.2026 – 02.02.2026: Portfolio -1,00\u00a0%");
    expect(screen.getByRole("combobox", { name: "Vergleich mit" })).toBeTruthy();
    expect(document.cookie).toContain("dm_chart_tab=ttwror");
  });

  it("starts in the stored Performance tab; without comparison data the tab is left out", () => {
    renderTabs("ttwror");
    expect(screen.getByRole("tab", { name: "Performance" }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    renderTabs("ttwror", null);
    expect(screen.queryByRole("tab", { name: "Performance" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Wertentwicklung" }).getAttribute("aria-selected")).toBe("true");
  });

  it("starts in the stored tab", () => {
    renderTabs("drawdown");
    expect(screen.getByRole("tab", { name: "Drawdown" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Aktueller Drawdown")).toBeTruthy();
  });
});
