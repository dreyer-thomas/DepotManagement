// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { navId, parseStore } from "./back-target";
import { BackLink, PageLabel } from "./BackLink";
import { HistoryTracker } from "./HistoryTracker";
import { ensureCurrentEntry, installHistoryTracking, STORAGE_KEY } from "./history-tracker";

vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }));

registerDomCleanup();

/** Depot "Comdirect" → Security X → X?depot=a. */
const CHAIN = {
  e1: { prev: null, path: "/depots/d1", pathname: "/depots/d1", label: "Comdirect" },
  e2: { prev: "e1", path: "/securities/x", pathname: "/securities/x", label: null },
  e3: { prev: "e2", path: "/securities/x?depot=a", pathname: "/securities/x", label: null },
};

/** Sets the state the way a browser traversal restores it, bypassing every wrapper. */
function nativeReplace(state: unknown, url: string) {
  History.prototype.replaceState.call(window.history, state, "", url);
}

const PARENT = { href: "/securities", label: "Wertpapiere" };

function seed(entries: Record<string, { prev: string | null; path: string; pathname: string; label: string | null }>, currentId: string, url: string) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ entries }));
  window.history.replaceState({ __dmNav: { id: currentId } }, "", url);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackLink", () => {
  it("server-renders the fallback parent", () => {
    const html = renderToString(<BackLink parent={PARENT} self="X" />);
    expect(html).toContain('href="/securities"');
    expect(html).toContain('aria-label="Zurück zu Wertpapiere"');
  });

  it("links to the parent without an in-app origin", async () => {
    window.history.replaceState(null, "", "/securities/x");
    render(<BackLink parent={PARENT} self="X" />);
    const link = screen.getByRole("link", { name: "Zurück zu Wertpapiere" });
    expect(link.getAttribute("href")).toBe("/securities");
    expect(link.textContent).toBe("‹ Wertpapiere");
    // The page registered itself for later back links.
    await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('"label":"X"'));
  });

  it("returns to the origin by history traversal", async () => {
    seed(
      {
        e1: { prev: null, path: "/depots/d1", pathname: "/depots/d1", label: "Comdirect" },
        e2: { prev: "e1", path: "/securities/x", pathname: "/securities/x", label: null },
        e3: { prev: "e2", path: "/securities/x?depot=a", pathname: "/securities/x", label: null },
      },
      "e3",
      "/securities/x?depot=a",
    );
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    render(<BackLink parent={PARENT} self="X" />);
    const link = await screen.findByRole("link", { name: "Zurück zu Comdirect" });
    expect(link.getAttribute("href")).toBe("/depots/d1");
    expect(link.textContent).toBe("‹ Comdirect");
    fireEvent.click(link);
    expect(go).toHaveBeenCalledWith(-2);
  });

  it("falls back when sessionStorage throws", () => {
    window.history.replaceState({ __dmNav: { id: "e2" } }, "", "/securities/x");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<BackLink parent={PARENT} self="X" />);
    expect(screen.getByRole("link", { name: "Zurück zu Wertpapiere" }).getAttribute("href")).toBe("/securities");
  });

  it("records pushes so a later page names the registered origin", async () => {
    window.history.replaceState(null, "", "/watchlists?list=w1");
    const { unmount } = render(<PageLabel label="Ideen" />);
    await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('"label":"Ideen"'));
    unmount();
    window.history.pushState(null, "", "/securities/x");
    render(<BackLink parent={PARENT} self="X" />);
    const link = await screen.findByRole("link", { name: "Zurück zu Ideen" });
    expect(link.getAttribute("href")).toBe("/watchlists?list=w1");
  });

  it("re-resolves on popstate after a traversal within the page", async () => {
    seed(CHAIN, "e3", "/securities/x?depot=a");
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    render(<BackLink parent={PARENT} self="X" />);
    await screen.findByRole("link", { name: "Zurück zu Comdirect" });
    // Browser back to the previous in-page entry: the state is restored, then popstate fires.
    nativeReplace({ __dmNav: { id: "e2" } }, "/securities/x");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole("link", { name: "Zurück zu Comdirect" }));
      expect(go).toHaveBeenLastCalledWith(-1);
    });
  });

  it("keeps the entry id on a replace without one and adds no hop", async () => {
    seed(CHAIN, "e3", "/securities/x?depot=a");
    render(<BackLink parent={PARENT} self="X" />);
    await screen.findByRole("link", { name: "Zurück zu Comdirect" });
    window.history.replaceState({ other: 1 }, "", "/securities/x?depot=b");
    expect(navId(window.history.state)).toBe("e3");
    const store = parseStore(window.sessionStorage.getItem(STORAGE_KEY));
    expect(Object.keys(store.entries).sort()).toEqual(["e1", "e2", "e3"]);
    expect(store.entries.e3).toMatchObject({ prev: "e2", path: "/securities/x?depot=b" });
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("link", { name: "Zurück zu Comdirect" }));
    expect(go).toHaveBeenCalledWith(-2);
  });

  it("names an unlabeled top-level origin recorded by HistoryTracker", async () => {
    window.history.replaceState(null, "", "/");
    const tracker = render(<HistoryTracker />);
    await waitFor(() => expect(parseStore(window.sessionStorage.getItem(STORAGE_KEY)).entries).not.toEqual({}));
    tracker.unmount();
    window.history.pushState(null, "", "/securities/x");
    render(<BackLink parent={PARENT} self="X" />);
    const link = await screen.findByRole("link", { name: "Zurück zu Übersicht" });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("coexists with a Next.js-style history patch installed on top", () => {
    installHistoryTracking();
    window.history.replaceState(null, "", "/depots/d1");
    const previous = ensureCurrentEntry();
    const ours = { push: window.history.pushState, replace: window.history.replaceState };
    const copyInternals = (data: Record<string, unknown> | null) => {
      const result: Record<string, unknown> = { ...(data ?? {}) };
      const current = window.history.state as Record<string, unknown> | null;
      if (current?.__NA) result.__NA = current.__NA;
      if (current?.__PRIVATE_NEXTJS_INTERNALS_TREE) result.__PRIVATE_NEXTJS_INTERNALS_TREE = current.__PRIVATE_NEXTJS_INTERNALS_TREE;
      return result;
    };
    const originalPush = window.history.pushState.bind(window.history);
    const originalReplace = window.history.replaceState.bind(window.history);
    window.history.pushState = (data: Record<string, unknown> | null, unused: string, url?: string | URL | null) =>
      originalPush(data?.__NA ? data : copyInternals(data), unused, url);
    window.history.replaceState = (data: Record<string, unknown> | null, unused: string, url?: string | URL | null) =>
      originalReplace(data?.__NA ? data : copyInternals(data), unused, url);
    expect(window.history.pushState).not.toBe(ours.push);
    try {
      const tree = { tree: ["", { children: ["securities"] }], renderedSearch: "" };
      window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree }, "", "/securities/x");
      const state = window.history.state as Record<string, unknown>;
      expect(state.__NA).toBe(true);
      expect(state.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(tree);
      const id = navId(state);
      expect(id).not.toBeNull();
      expect(id).not.toBe(previous);
      expect(parseStore(window.sessionStorage.getItem(STORAGE_KEY)).entries[id!]).toMatchObject({
        prev: previous,
        path: "/securities/x",
      });
    } finally {
      window.history.pushState = ours.push;
      window.history.replaceState = ours.replace;
    }
  });

  it("leaves modifier and middle clicks to the browser", async () => {
    seed(CHAIN, "e3", "/securities/x?depot=a");
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    render(<BackLink parent={PARENT} self="X" />);
    const link = await screen.findByRole("link", { name: "Zurück zu Comdirect" });
    // Keep happy-dom from following the link.
    link.addEventListener("click", (event) => event.preventDefault());
    link.addEventListener("auxclick", (event) => event.preventDefault());
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { button: 1 });
    expect(go).not.toHaveBeenCalled();
  });
});
