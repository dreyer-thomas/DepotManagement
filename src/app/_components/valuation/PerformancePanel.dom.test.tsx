// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { PerformancePanel, type PerformancePanelProps } from "./PerformancePanel";

registerDomCleanup();

const NBSP = " ";
const LINE = [
  { date: "2026-01-31", performance: "0" },
  { date: "2026-02-01", performance: "0.1" },
  { date: "2026-02-02", performance: "0.134375" },
];
const WORLD = [
  { date: "2026-01-31", performance: "0" },
  { date: "2026-02-01", performance: "0" },
  { date: "2026-02-02", performance: "0.03" },
];
const FLAT = LINE.map(({ date }) => ({ date, performance: "0" }));
const OPTIONS: PerformancePanelProps["options"] = [
  { key: "msci-world", label: "MSCI World", line: WORLD, ttwror: "0.03" },
  { key: "dax", label: "DAX", line: null, ttwror: null },
  { key: "portfolio", label: "Gesamtportfolio", line: LINE, ttwror: "0.134375" },
  { key: "depot:b", label: "Zweitdepot", line: WORLD, ttwror: "0.03" },
  // A Depot without investment in the Period: a flat line, but no Period TTWROR.
  { key: "depot:c", label: "Leerdepot", line: FLAT, ttwror: null },
];

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
  document.cookie = "dm_benchmark=; path=/; max-age=0";
});

function renderPanel(initialChoice = "none", { line = LINE, ttwror = "0.134375" as string | null } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <PerformancePanel scopeLabel="Hauptdepot" line={line} ttwror={ttwror} options={OPTIONS} initialChoice={initialChoice} />
    </ThemeProvider>,
  );
}

const figure = () => screen.getByRole("figure").getAttribute("aria-label");

describe("PerformancePanel", () => {
  it("shows the scope line and its return only without a comparison", () => {
    renderPanel();
    expect(screen.getByRole("combobox", { name: "Vergleich mit" }).textContent).toBe("keiner");
    expect(figure()).toBe(`Performance 31.01.2026 – 02.02.2026: Hauptdepot +13,44${NBSP}%`);
    expect(screen.getByText("Performance")).toBeTruthy();
    expect(screen.getByText("+13,44 %")).toBeTruthy();
    expect(screen.queryByText("Differenz")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Legende" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("offers keiner and every option, draws the chosen comparison with a legend, KPIs and the difference, storing the choice", async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await user.click(screen.getByRole("combobox", { name: "Vergleich mit" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "keiner",
      "MSCI World",
      "DAX",
      "Gesamtportfolio",
      "Zweitdepot",
      "Leerdepot",
    ]);
    await user.click(screen.getByRole("option", { name: "MSCI World" }));
    expect(figure()).toBe(`Performance 31.01.2026 – 02.02.2026: Hauptdepot +13,44${NBSP}%, MSCI World +3,00${NBSP}%`);
    const legend = within(screen.getByRole("list", { name: "Legende" })).getAllByRole("listitem");
    expect(legend.map((item) => item.textContent)).toEqual(["Hauptdepot", "MSCI World"]);
    expect(legend[1].querySelector("line")?.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(legend[0].querySelector("line")?.getAttribute("stroke-dasharray")).toBeNull();
    expect(screen.getByText("+3,00 %")).toBeTruthy();
    expect(screen.getByText("Differenz")).toBeTruthy();
    expect(screen.getByText("+10,44 Pp.")).toBeTruthy();
    expect(document.cookie).toContain("dm_benchmark=msci-world");
  });

  it("says Keine Kurse für den Vergleich for a comparison without prices, without comparison KPIs", () => {
    renderPanel("dax");
    expect(screen.getByText("Keine Kurse für den Vergleich")).toBeTruthy();
    expect(figure()).toBe(`Performance 31.01.2026 – 02.02.2026: Hauptdepot +13,44${NBSP}%`);
    expect(screen.queryByText("Differenz")).toBeNull();
  });

  it("starts with the stored choice", () => {
    renderPanel("depot:b");
    expect(screen.getByRole("combobox", { name: "Vergleich mit" }).textContent).toBe("Zweitdepot");
    expect(screen.getByText("+10,44 Pp.")).toBeTruthy();
  });

  it("treats a stored choice that is no option (e.g. the Depot itself) as keiner", () => {
    renderPanel("depot:a");
    expect(screen.getByRole("combobox", { name: "Vergleich mit" }).textContent).toBe("keiner");
    expect(figure()).toBe(`Performance 31.01.2026 – 02.02.2026: Hauptdepot +13,44${NBSP}%`);
    expect(within(screen.getByRole("list", { name: "Legende" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("Differenz")).toBeNull();
    expect(screen.queryByText("Keine Kurse für den Vergleich")).toBeNull();
  });

  it("shows – for a scope without Period TTWROR (as the hero) and no Differenz", () => {
    renderPanel("msci-world", { line: FLAT, ttwror: null });
    expect(screen.getAllByText("–")).toHaveLength(1);
    expect(screen.queryByText("+0,00 %", { selector: "p" })).toBeNull();
    expect(screen.getByText("+3,00 %", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("Differenz")).toBeNull();
  });

  it("shows – for a comparison without Period TTWROR and no Differenz", () => {
    renderPanel("depot:c");
    expect(within(screen.getByRole("list", { name: "Legende" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("–")).toHaveLength(1);
    expect(screen.getByText("+13,44 %", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("+0,00 %", { selector: "p" })).toBeNull();
    expect(screen.queryByText("Differenz")).toBeNull();
  });
});
