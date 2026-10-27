// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { AnalysisFilters } from "./AnalysisFilters";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));

registerDomCleanup();

const depots = [
  { id: "d1", name: "Hauptdepot" },
  { id: "d2", name: "Zweitdepot" },
];

beforeEach(() => replace.mockReset());

describe("AnalysisFilters", () => {
  it("hides 'Bereich' on the Steuern tab (the broker is the tax unit)", () => {
    const { container } = render(<AnalysisFilters tab="taxes" depots={depots} scope="portfolio" dimension="sector" />);
    expect(screen.queryByRole("combobox", { name: "Bereich" })).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("offers the Portfolio and the Depots and keeps the dimension when the scope changes", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AnalysisFilters tab="allocation" depots={depots} scope="portfolio" dimension="sector" />);
    const scope = screen.getByRole("combobox", { name: "Bereich" });
    expect(scope.textContent).toBe("Portfolio");
    await user.click(scope);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Portfolio", "Hauptdepot", "Zweitdepot"]);
    await user.click(options[2]);
    expect(replace).toHaveBeenCalledWith("/analyses?tab=allocation&scope=d2&dimension=sector", { scroll: false });
  });

  it("offers every dimension and keeps the scope when the dimension changes", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AnalysisFilters tab="allocation" depots={depots} scope="d1" dimension="assetClass" />);
    const dimension = screen.getByRole("combobox", { name: "Dimension" });
    expect(dimension.textContent).toBe("Anlageklasse");
    await user.click(dimension);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Anlageklasse",
      "Wertpapiertyp",
      "Sektor",
      "Branche",
      "Region",
      "Land",
      "Unternehmensgröße",
      "Währung",
    ]);
    await user.click(options[4]);
    expect(replace).toHaveBeenCalledWith("/analyses?tab=allocation&scope=d1&dimension=region", { scroll: false });
  });

  it("hides the dimension on the Rendite tab and keeps the tab when the scope changes", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AnalysisFilters tab="returns" depots={depots} scope="portfolio" dimension="sector" />);
    expect(screen.queryByRole("combobox", { name: "Dimension" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Bereich" }));
    const options = await screen.findAllByRole("option");
    await user.click(options[1]);
    expect(replace).toHaveBeenCalledWith("/analyses?tab=returns&scope=d1&dimension=sector", { scroll: false });
  });

  it("shows 'Bereich' without the dimension on the Zielallokation tab", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AnalysisFilters tab="targets" depots={depots} scope="portfolio" dimension="sector" />);
    expect(screen.queryByRole("combobox", { name: "Dimension" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Bereich" }));
    const options = await screen.findAllByRole("option");
    await user.click(options[2]);
    expect(replace).toHaveBeenCalledWith("/analyses?tab=targets&scope=d2&dimension=sector", { scroll: false });
  });

  it("is keyboard-operable", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AnalysisFilters tab="allocation" depots={depots} scope="portfolio" dimension="assetClass" />);
    screen.getByRole("combobox", { name: "Dimension" }).focus();
    await user.keyboard("{Enter}");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(replace).toHaveBeenCalledWith("/analyses?tab=allocation&scope=portfolio&dimension=type", { scroll: false });
  });
});
