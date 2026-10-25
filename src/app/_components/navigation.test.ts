import { describe, expect, it } from "vitest";
import { activeBottomHref, isActive } from "./navigation";

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
    expect(activeBottomHref("/more")).toBe("/more");
  });

  it.each(["/settings", "/import", "/securities"])("maps %s to /more", (path) => {
    expect(activeBottomHref(path)).toBe("/more");
  });

  it("returns false for unknown paths", () => {
    expect(activeBottomHref("/unknown")).toBe(false);
  });
});
