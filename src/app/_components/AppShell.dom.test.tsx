// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../test/helpers/dom";
import { AppShell } from "./AppShell";
import { MoreLinks } from "./MoreLinks";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("../_actions/logout", () => ({ logout: vi.fn() }));

registerDomCleanup();

/** The drawer and the bottom navigation are both labelled "Hauptnavigation" (CSS hides one per breakpoint). */
function navs() {
  const [drawer, bottom] = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="Hauptnavigation"]'));
  return { drawer: drawer!, bottom: bottom! };
}

describe("AppShell open-import count", () => {
  it("shows the count on the drawer's Import entry and on Mehr", () => {
    render(<AppShell openImports={2}>page</AppShell>);
    const { drawer, bottom } = navs();
    const importLink = within(drawer).getByRole("link", { name: /Import/, hidden: true });
    expect(within(importLink).getByLabelText("2 offene Importe").textContent).toBe("2");
    const moreLink = within(bottom).getByRole("link", { name: /Mehr/, hidden: true });
    expect(within(moreLink).getByLabelText("2 offene Importe").textContent).toBe("2");
    expect(screen.getAllByLabelText("2 offene Importe")).toHaveLength(2);
  });

  it("shows no badge at 0", () => {
    render(<AppShell openImports={0}>page</AppShell>);
    expect(screen.queryByLabelText(/offene[r]? Import/)).toBeNull();
  });
});

describe("MoreLinks open-import count", () => {
  it("shows the count on the Import row only", () => {
    render(<MoreLinks openImports={2} />);
    const importLink = screen.getByRole("link", { name: /Import/ });
    expect(within(importLink).getByLabelText("2 offene Importe").textContent).toBe("2");
    expect(screen.getAllByLabelText("2 offene Importe")).toHaveLength(1);
  });

  it("shows no count at 0", () => {
    render(<MoreLinks />);
    expect(screen.queryByLabelText(/offene[r]? Import/)).toBeNull();
  });
});

describe("Watchlists navigation", () => {
  it("lists Watchlists between Wertpapiere and Einstellungen in the drawer", () => {
    render(<AppShell openImports={0}>page</AppShell>);
    const { drawer } = navs();
    const labels = within(drawer)
      .getAllByRole("link", { hidden: true })
      .map((link) => link.textContent);
    expect(labels.slice(-3)).toEqual(["Wertpapiere", "Watchlists", "Einstellungen"]);
    expect(within(drawer).getByRole("link", { name: "Watchlists", hidden: true }).getAttribute("href")).toBe("/watchlists");
  });
});

describe("Analysen navigation", () => {
  it("lists Analysen between Depots and Import in the drawer", () => {
    render(<AppShell openImports={0}>page</AppShell>);
    const { drawer } = navs();
    const labels = within(drawer)
      .getAllByRole("link", { hidden: true })
      .map((link) => link.textContent);
    expect(labels.slice(1, 4)).toEqual(["Depots", "Analysen", "Import"]);
    expect(within(drawer).getByRole("link", { name: "Analysen", hidden: true }).getAttribute("href")).toBe("/analyses");
  });

  it("no longer lists Analysen under Mehr (it is in the bottom navigation)", () => {
    render(<MoreLinks />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Import", "Wertpapiere", "Watchlists", "Einstellungen"]);
  });
});
