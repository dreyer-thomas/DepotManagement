import { describe, expect, it } from "vitest";
import {
  deleteWatchlistQuestion,
  entryCountText,
  watchlistEntryErrorField,
  watchlistEntryErrorMessage,
  watchlistErrorField,
  watchlistErrorMessage,
} from "./labels";
import { selectWatchlistId, watchlistHref } from "./watchlist-cookie";

describe("watchlist labels", () => {
  it("names list failures in German, name errors on the name field", () => {
    expect(watchlistErrorMessage("name-taken")).toBe("Name ist schon vergeben");
    expect(watchlistErrorMessage("name-too-long")).toBe("Höchstens 60 Zeichen.");
    expect(watchlistErrorMessage("name-empty")).toBe("Bitte einen Namen eingeben.");
    expect(watchlistErrorField("name-taken")).toBe("name");
    expect(watchlistErrorField("not-found")).toBeUndefined();
  });

  it("names entry failures in German and places them on their field", () => {
    expect(watchlistEntryErrorMessage("already-on-list")).toBe("Steht schon auf dieser Liste");
    expect(watchlistEntryErrorMessage("note-too-long")).toBe("Höchstens 2000 Zeichen.");
    expect(watchlistEntryErrorMessage("date-invalid")).toBe("Bitte ein gültiges Datum bis heute wählen.");
    expect(watchlistEntryErrorMessage("isin-invalid")).toBe("Bitte eine gültige ISIN eingeben.");
    expect(watchlistEntryErrorField("isin-invalid")).toBe("securityIdentifier");
    expect(watchlistEntryErrorField("security-name-invalid")).toBe("securityName");
    expect(watchlistEntryErrorField("already-on-list")).toBe("security");
    expect(watchlistEntryErrorField("date-invalid")).toBe("dateAdded");
    expect(watchlistEntryErrorField("unauthorized")).toBeUndefined();
  });

  it("counts entries and names list and count in the delete question", () => {
    expect(entryCountText(1)).toBe("1 Eintrag");
    expect(entryCountText(3)).toBe("3 Einträge");
    expect(deleteWatchlistQuestion("Ideen", 3)).toBe("Watchlist „Ideen“ mit 3 Einträgen löschen? Die Wertpapiere und ihre Kurse bleiben erhalten.");
    expect(deleteWatchlistQuestion("Ideen", 1)).toContain("mit 1 Eintrag löschen?");
    expect(deleteWatchlistQuestion("Leer", 0)).toBe("Watchlist „Leer“ löschen? Die Wertpapiere und ihre Kurse bleiben erhalten.");
  });
});

describe("selectWatchlistId", () => {
  const lists = [{ id: "a" }, { id: "b" }];
  it("prefers ?list=, then the remembered list, then the first; null without lists", () => {
    expect(selectWatchlistId(lists, "b", "a")).toBe("b");
    expect(selectWatchlistId(lists, "gone", "b")).toBe("b");
    expect(selectWatchlistId(lists, null, "gone")).toBe("a");
    expect(selectWatchlistId([], "a", "a")).toBeNull();
    expect(watchlistHref("a b")).toBe("/watchlists?list=a%20b");
  });
});
