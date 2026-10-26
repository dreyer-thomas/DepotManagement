import { describe, expect, it } from "vitest";
import { articleMeta, newsHref, newsPartialFailureMessage } from "./labels";

describe("news labels", () => {
  it("formats the meta line with the Berlin date", () => {
    expect(articleMeta("Beispiel Zeitung", "2026-10-25T23:30:00.000Z")).toBe("Beispiel Zeitung · 26.10.2026");
    expect(articleMeta("Example Wire", "2026-10-25T18:00:00.000Z")).toBe("Example Wire · 25.10.2026");
  });

  it("counts failed Securities", () => {
    expect(newsPartialFailureMessage(1)).toBe("Nachrichten für 1 Wertpapier konnten nicht geladen werden.");
    expect(newsPartialFailureMessage(3)).toBe("Nachrichten für 3 Wertpapiere konnten nicht geladen werden.");
  });

  it("builds the filter URLs", () => {
    expect(newsHref(undefined)).toBe("/news");
    expect(newsHref("")).toBe("/news");
    expect(newsHref("c1 x")).toBe("/news?security=c1%20x");
  });
});
