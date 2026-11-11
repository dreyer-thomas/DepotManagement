// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { NewsFilter } from "./NewsFilter";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

registerDomCleanup();

const securities = [
  { id: "s1", name: "SAP SE" },
  { id: "s2", name: "Siemens AG" },
];

beforeEach(() => push.mockReset());

describe("NewsFilter", () => {
  it("offers the listed Securities and navigates to the filtered page", async () => {
    const user = userEvent.setup({ delay: null });
    render(<NewsFilter securities={securities} selected={undefined} scope="all" />);
    const select = screen.getByRole("combobox", { name: "Wertpapier" });
    expect(select.textContent).toBe("Alle Wertpapiere");
    await user.click(select);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Alle Wertpapiere",
      "SAP SE",
      "Siemens AG",
    ]);
    await user.click(screen.getByRole("option", { name: "Siemens AG" }));
    expect(push).toHaveBeenCalledWith("/news?security=s2");
  });

  it("shows the selected Security and goes back to all", async () => {
    const user = userEvent.setup({ delay: null });
    render(<NewsFilter securities={securities} selected="s1" scope="all" />);
    const select = screen.getByRole("combobox", { name: "Wertpapier" });
    expect(select.textContent).toBe("SAP SE");
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Alle Wertpapiere" }));
    expect(push).toHaveBeenCalledWith("/news");
  });

  it("treats an unknown selection as all", () => {
    render(<NewsFilter securities={securities} selected="unknown" scope="all" />);
    expect(screen.getByRole("combobox", { name: "Wertpapier" }).textContent).toBe("Alle Wertpapiere");
  });

  it("keeps the scope when picking a Security", async () => {
    const user = userEvent.setup({ delay: null });
    render(<NewsFilter securities={securities} selected={undefined} scope="watched" />);
    await user.click(screen.getByRole("combobox", { name: "Wertpapier" }));
    await user.click(await screen.findByRole("option", { name: "SAP SE" }));
    expect(push).toHaveBeenCalledWith("/news?scope=watched&security=s1");
  });

  it("switches the scope Alle · Depot · Watchlist and resets the Security", async () => {
    const user = userEvent.setup({ delay: null });
    render(<NewsFilter securities={securities} selected="s1" scope="all" />);
    const group = screen.getByRole("group", { name: "Nachrichten zeigen für" });
    expect(screen.getByRole("button", { name: "Alle" }).getAttribute("aria-pressed")).toBe("true");
    expect(group.textContent).toBe("AlleDepotWatchlist");
    await user.click(screen.getByRole("button", { name: "Watchlist" }));
    expect(push).toHaveBeenLastCalledWith("/news?scope=watched");
    await user.click(screen.getByRole("button", { name: "Depot" }));
    expect(push).toHaveBeenLastCalledWith("/news?scope=held");
    await user.click(screen.getByRole("button", { name: "Alle" }));
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("hides the Security select when the scope lists none", () => {
    render(<NewsFilter securities={[]} selected={undefined} scope="watched" />);
    expect(screen.queryByRole("combobox", { name: "Wertpapier" })).toBeNull();
    expect(screen.getByRole("button", { name: "Watchlist" }).getAttribute("aria-pressed")).toBe("true");
  });
});
