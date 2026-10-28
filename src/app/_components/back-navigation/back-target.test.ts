import { describe, expect, it } from "vitest";
import {
  annotatePush,
  annotateReplace,
  defaultPageLabel,
  emptyStore,
  MAX_ENTRIES,
  type NavStore,
  navId,
  parseStore,
  recordEntry,
  resolveBack,
} from "./back-target";

const SECURITIES = { href: "/securities", label: "Wertpapiere" };

/** Builds a store by pushing `pages` in order (ids e1, e2, …); each page is [path, label?]. */
function pushAll(pages: [string, string?][]): NavStore {
  let store = emptyStore();
  pages.forEach(([path, label], index) => {
    const pathname = path.split("?")[0]!;
    store = recordEntry(store, `e${index + 1}`, { prev: index === 0 ? null : `e${index}`, path, pathname });
    if (label !== undefined) store = recordEntry(store, `e${index + 1}`, { path, pathname, label });
  });
  return store;
}

describe("defaultPageLabel", () => {
  it("names top-level pages by their navigation label", () => {
    expect(defaultPageLabel("/")).toBe("Übersicht");
    expect(defaultPageLabel("/depots")).toBe("Depots");
    expect(defaultPageLabel("/analyses")).toBe("Analysen");
    expect(defaultPageLabel("/import")).toBe("Import");
    expect(defaultPageLabel("/news")).toBe("Nachrichten");
    expect(defaultPageLabel("/securities")).toBe("Wertpapiere");
    expect(defaultPageLabel("/watchlists")).toBe("Watchlists");
    expect(defaultPageLabel("/settings")).toBe("Einstellungen");
    expect(defaultPageLabel("/more")).toBe("Mehr");
  });

  it("prefix-matches deeper unknown paths", () => {
    expect(defaultPageLabel("/settings/parqet")).toBe("Einstellungen");
    expect(defaultPageLabel("/depots/abc/reconcile")).toBe("Depots");
    expect(defaultPageLabel("/nowhere")).toBe("Zurück");
  });
});

describe("resolveBack", () => {
  it("returns to the origin page by one hop: Depots → Depot → Security", () => {
    const store = pushAll([["/depots"], ["/depots/d1", "Comdirect"], ["/securities/x", "X"]]);
    expect(resolveBack(store, "e3", "/securities/x", SECURITIES)).toEqual({
      kind: "history",
      steps: 1,
      href: "/depots/d1",
      label: "Comdirect",
    });
  });

  it("skips in-page changes of the current page and counts them as hops", () => {
    const store = pushAll([["/watchlists?list=w1", "Ideen"], ["/securities/x", "X"], ["/securities/x?depot=a"], ["/securities/x?depot=b"]]);
    expect(resolveBack(store, "e4", "/securities/x", SECURITIES)).toEqual({
      kind: "history",
      steps: 3,
      href: "/watchlists?list=w1",
      label: "Ideen",
    });
  });

  it("falls back to the parent without an origin (direct open, new tab, bookmark)", () => {
    const store = pushAll([["/securities/x", "X"]]);
    expect(resolveBack(store, "e1", "/securities/x", SECURITIES)).toEqual({ kind: "link", href: "/securities", label: "Wertpapiere" });
    expect(resolveBack(store, null, "/securities/x", SECURITIES)).toEqual({ kind: "link", href: "/securities", label: "Wertpapiere" });
  });

  it("survives a reload: the same store and id resolve the same origin", () => {
    const store = pushAll([["/depots/d1", "Comdirect"], ["/securities/x", "X"]]);
    const reloaded = parseStore(JSON.stringify(store));
    expect(resolveBack(reloaded, "e2", "/securities/x", SECURITIES)).toMatchObject({ kind: "history", steps: 1, label: "Comdirect" });
  });

  it("follows back/forward: the current id moves within the chain", () => {
    const store = pushAll([["/depots"], ["/depots/d1", "Comdirect"], ["/securities/x", "X"]]);
    // Back to the Depot: its origin is the Depots list.
    expect(resolveBack(store, "e2", "/depots/d1", { href: "/depots", label: "Depots" })).toEqual({
      kind: "history",
      steps: 1,
      href: "/depots",
      label: "Depots",
    });
    // Forward to the Security again.
    expect(resolveBack(store, "e3", "/securities/x", SECURITIES)).toMatchObject({ kind: "history", label: "Comdirect" });
  });

  it("does not count a replaced entry as a hop and keeps its label", () => {
    let store = pushAll([["/depots/d1", "Comdirect"], ["/securities/x", "X"]]);
    store = recordEntry(store, "e2", { path: "/securities/x?depot=d1", pathname: "/securities/x" });
    expect(store.entries.e2).toEqual({ prev: "e1", path: "/securities/x?depot=d1", pathname: "/securities/x", label: "X" });
    expect(resolveBack(store, "e2", "/securities/x", SECURITIES)).toMatchObject({ kind: "history", steps: 1 });
  });

  it("falls back on a broken or cyclic chain", () => {
    const missing = recordEntry(emptyStore(), "e2", { prev: "gone", path: "/securities/x", pathname: "/securities/x" });
    expect(resolveBack(missing, "e2", "/securities/x", SECURITIES).kind).toBe("link");
    expect(resolveBack(emptyStore(), "e9", "/securities/x", SECURITIES).kind).toBe("link");
    const cyclic: NavStore = {
      entries: {
        a: { prev: "b", path: "/securities/x", pathname: "/securities/x", label: null },
        b: { prev: "a", path: "/securities/x?depot=1", pathname: "/securities/x", label: null },
      },
    };
    expect(resolveBack(cyclic, "a", "/securities/x", SECURITIES).kind).toBe("link");
  });

  it("names a Security origin by the Security's name", () => {
    const store = pushAll([["/securities/y", "Y AG"], ["/securities/x", "X"]]);
    expect(resolveBack(store, "e2", "/securities/x", SECURITIES)).toMatchObject({ kind: "history", href: "/securities/y", label: "Y AG" });
  });

  it("prefers a registered label over the navigation label", () => {
    const unlabeled = pushAll([["/analyses?tab=tax"], ["/securities/x", "X"]]);
    expect(resolveBack(unlabeled, "e2", "/securities/x", SECURITIES)).toMatchObject({ href: "/analyses?tab=tax", label: "Analysen" });
    const labeled = pushAll([["/watchlists", "Ideen"], ["/securities/x", "X"]]);
    expect(resolveBack(labeled, "e2", "/securities/x", SECURITIES)).toMatchObject({ label: "Ideen" });
  });
});

describe("recordEntry", () => {
  it("inherits the label of an in-page predecessor and resets it on a pathname change", () => {
    let store = pushAll([["/watchlists?list=a", "Ideen"]]);
    store = recordEntry(store, "e2", { prev: "e1", path: "/watchlists?list=b", pathname: "/watchlists" });
    expect(store.entries.e2!.label).toBe("Ideen");
    store = recordEntry(store, "e2", { path: "/news", pathname: "/news" });
    expect(store.entries.e2!.label).toBeNull();
    expect(store.entries.e2!.prev).toBe("e1");
  });

  it("caps the store, dropping the oldest entries", () => {
    let store = emptyStore();
    for (let index = 0; index < MAX_ENTRIES + 5; index += 1) {
      store = recordEntry(store, `e${index}`, { prev: index === 0 ? null : `e${index - 1}`, path: "/", pathname: "/" });
    }
    expect(Object.keys(store.entries)).toHaveLength(MAX_ENTRIES);
    expect(store.entries.e0).toBeUndefined();
    expect(store.entries[`e${MAX_ENTRIES + 4}`]).toBeDefined();
  });

  it("keeps a re-recorded entry when evicting, even if it was inserted first", () => {
    let store = recordEntry(emptyStore(), "origin", { prev: null, path: "/depots/d1", pathname: "/depots/d1", label: "Comdirect" });
    for (let index = 0; index < MAX_ENTRIES - 1; index += 1) {
      store = recordEntry(store, `e${index}`, { prev: null, path: "/", pathname: "/" });
    }
    // A traversal back to the origin re-records it; the next pushes must evict others first.
    store = recordEntry(store, "origin", { path: "/depots/d1", pathname: "/depots/d1" });
    store = recordEntry(store, "x1", { prev: "origin", path: "/securities/x", pathname: "/securities/x" });
    store = recordEntry(store, "x2", { prev: "x1", path: "/securities/x?depot=a", pathname: "/securities/x" });
    expect(Object.keys(store.entries)).toHaveLength(MAX_ENTRIES);
    expect(store.entries.origin).toMatchObject({ label: "Comdirect" });
    expect(store.entries.e0).toBeUndefined();
    expect(store.entries.e1).toBeUndefined();
    expect(resolveBack(store, "x2", "/securities/x", SECURITIES)).toMatchObject({ kind: "history", steps: 2, label: "Comdirect" });
  });
});

describe("history state helpers", () => {
  it("adds a new id on push and keeps Next.js internals", () => {
    const data = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: 1 }, __dmNav: { id: "old" } };
    const pushed = annotatePush(data, "new");
    expect(pushed).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: 1 }, __dmNav: { id: "new" } });
    expect(navId(pushed)).toBe("new");
  });

  it("keeps the current id on a replace without one", () => {
    const data = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: 2 } };
    expect(annotateReplace(data, "cur")).toEqual({ ...data, __dmNav: { id: "cur" } });
    expect(annotateReplace({ __dmNav: { id: "own" } }, "cur")).toEqual({ __dmNav: { id: "own" } });
    expect(annotateReplace(null, null)).toBeNull();
  });

  it("parses only well-formed stores", () => {
    expect(parseStore("not json")).toEqual(emptyStore());
    expect(parseStore(null)).toEqual(emptyStore());
    expect(parseStore(JSON.stringify({ entries: { a: { prev: 3, path: "/" }, b: { prev: null, path: "/", pathname: "/" } } }))).toEqual({
      entries: { b: { prev: null, path: "/", pathname: "/", label: null } },
    });
  });
});
