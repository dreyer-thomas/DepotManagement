// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
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

function renderTabs(initialTab: "performance" | "drawdown" = "performance") {
  return render(
    <ThemeProvider theme={theme}>
      <ValueChartTabs points={POINTS} drawdown={DRAWDOWN} initialTab={initialTab} />
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

  it("starts in the stored tab", () => {
    renderTabs("drawdown");
    expect(screen.getByRole("tab", { name: "Drawdown" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Aktueller Drawdown")).toBeTruthy();
  });
});
