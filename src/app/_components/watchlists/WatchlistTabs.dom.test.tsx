// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { WatchlistTabs } from "./WatchlistTabs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

registerDomCleanup();

describe("WatchlistTabs", () => {
  it("links each list in order and remembers the shown list in the dm_watchlist cookie", () => {
    document.cookie = "dm_watchlist=; max-age=0; path=/";
    render(
      <WatchlistTabs
        lists={[
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ]}
        selectedId="b"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["A", "B"]);
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(["/watchlists?list=a", "/watchlists?list=b"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.cookie).toContain("dm_watchlist=b");
  });
});
