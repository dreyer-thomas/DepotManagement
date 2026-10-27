import { describe, expect, it } from "vitest";
import { activeBottomHref, bottomItems, drawerItems, isActive, moreItems, navBadgeCount, openImportsLabel } from "./navigation";

describe("isActive", () => {
  it("matches / only by itself", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/", "/depots")).toBe(false);
  });

  it("matches a route and its sub-routes, not prefixes of other names", () => {
    expect(isActive("/depots", "/depots")).toBe(true);
    expect(isActive("/depots", "/depots/abc")).toBe(true);
    expect(isActive("/depots", "/depotsx")).toBe(false);
  });
});

describe("activeBottomHref", () => {
  it("selects direct bottom items", () => {
    expect(activeBottomHref("/")).toBe("/");
    expect(activeBottomHref("/depots/abc")).toBe("/depots");
    expect(activeBottomHref("/news")).toBe("/news");
    expect(activeBottomHref("/analyses")).toBe("/analyses");
    expect(activeBottomHref("/more")).toBe("/more");
  });

  it.each(["/settings", "/import", "/securities"])("maps %s to /more", (path) => {
    expect(activeBottomHref(path)).toBe("/more");
  });

  it("returns false for unknown paths", () => {
    expect(activeBottomHref("/unknown")).toBe(false);
  });
});

describe("navBadgeCount", () => {
  it("shows the open-import count on Import and Mehr only", () => {
    expect(navBadgeCount("/import", 2)).toBe(2);
    expect(navBadgeCount("/more", 2)).toBe(2);
    expect(navBadgeCount("/depots", 2)).toBe(0);
    expect(navBadgeCount("/", 2)).toBe(0);
  });

  it("never shows a negative count", () => {
    expect(navBadgeCount("/import", -1)).toBe(0);
  });
});

describe("openImportsLabel", () => {
  it("names the count in German", () => {
    expect(openImportsLabel(1)).toBe("1 offener Import");
    expect(openImportsLabel(3)).toBe("3 offene Importe");
  });
});

describe("Analysen entry", () => {
  it("sits between Depots and Import in the drawer and in the phone bottom navigation, not under Mehr", () => {
    expect(drawerItems.map((item) => item.label)).toEqual([
      "Übersicht",
      "Depots",
      "Analysen",
      "Import",
      "Nachrichten",
      "Wertpapiere",
      "Einstellungen",
    ]);
    expect(bottomItems.map((item) => item.label)).toEqual(["Übersicht", "Depots", "Analysen", "Nachrichten", "Mehr"]);
    expect(moreItems.map((item) => item.label)).toEqual(["Import", "Wertpapiere", "Einstellungen"]);
  });
});
