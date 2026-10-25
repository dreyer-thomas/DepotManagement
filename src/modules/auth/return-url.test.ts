import { describe, expect, it } from "vitest";
import { safeReturnUrl } from "./return-url";

describe("safeReturnUrl", () => {
  it.each(["/", "/depots", "/depots?x=1", "/settings#a", "/loginhelp"])("keeps the local path %s", (value) => {
    expect(safeReturnUrl(value)).toBe(value);
  });

  it.each([
    undefined,
    null,
    "",
    "depots",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/login",
    "/login?next=/depots",
    "/login/",
    "/x/../login",
    "/\t/evil.com",
    "javascript:alert(1)",
  ])("falls back to / for %s", (value) => {
    expect(safeReturnUrl(value)).toBe("/");
  });
});
