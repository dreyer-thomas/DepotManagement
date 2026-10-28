// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { updateWatchlistEntryAction } from "@/app/_actions/watchlists";
import { theme } from "@/theme/theme";
import { WatchHeader } from "./WatchHeader";
import { WatchlistCard, type WatchlistCardEntry } from "./WatchlistCard";
import { WatchlistChips } from "./WatchlistChips";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_actions/watchlists", () => ({
  addWatchlistEntryAction: vi.fn(),
  updateWatchlistEntryAction: vi.fn(),
  removeWatchlistEntryAction: vi.fn(),
}));
vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

registerDomCleanup();

const update = vi.mocked(updateWatchlistEntryAction);
beforeEach(() => update.mockReset());

const SECURITY = { id: "s1", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null };
const PRICE = { price: "110", date: "2026-10-27", source: "provider" as const, fetchedAt: "2026-10-27T18:00:00.000Z", provider: "YAHOO" };

describe("WatchHeader", () => {
  it("shows the Price, the price date and the Period change labelled with the Period", () => {
    render(
      <ThemeProvider theme={theme}>
        <WatchHeader price={PRICE} security={SECURITY} priceChange={{ perUnit: "10", ratio: "0.1" }} periodLabel="1J" fetched to="2026-10-28" today="2026-10-28" />
      </ThemeProvider>,
    );
    const header = screen.getByRole("region", { name: "Kurs" });
    const shown = (header.textContent ?? "").replace(/\s/g, " ");
    expect(shown).toContain("Kurs110,00 €");
    expect(shown).toContain("+10,00 € · 1J +10,00 %");
    expect(within(header).getByText("Kurs vom 27.10.2026")).toBeTruthy();
  });

  it("shows a stale badge, Stand before today, and – without a change or Price", () => {
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <WatchHeader price={{ ...PRICE, date: "2026-10-01" }} security={SECURITY} priceChange={null} periodLabel="1M" fetched={false} to="2026-10-20" today="2026-10-28" />
      </ThemeProvider>,
    );
    expect(screen.getByText("Kurs vom 01.10.2026 – veraltet")).toBeTruthy();
    expect(screen.getByText("Stand 20.10.2026")).toBeTruthy();
    expect(screen.getByLabelText("Veränderung 1M").textContent).toBe("–");
    expect(screen.queryByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeNull();
    unmount();
    render(
      <ThemeProvider theme={theme}>
        <WatchHeader price={null} security={SECURITY} priceChange={null} periodLabel="1M" fetched={false} to="2026-10-28" today="2026-10-28" />
      </ThemeProvider>,
    );
    expect(screen.getByText("Kein Kurs vorhanden.")).toBeTruthy();
  });
});

describe("WatchHeader stale and watched", () => {
  it("adds the hint and the manual price action for a stale Price of a watched Security", () => {
    render(
      <ThemeProvider theme={theme}>
        <WatchHeader price={{ ...PRICE, date: "2026-10-01" }} security={SECURITY} priceChange={null} periodLabel="1M" fetched to="2026-10-28" today="2026-10-28" />
      </ThemeProvider>,
    );
    expect(screen.getByText("Kurs vom 01.10.2026 – veraltet")).toBeTruthy();
    expect(screen.getByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kurs manuell eintragen – SAP SE" })).toBeTruthy();
  });
});

describe("WatchlistChips", () => {
  it("links each list, nothing without lists", () => {
    const { container, unmount } = render(<WatchlistChips lists={[]} />);
    expect(container.textContent).toBe("");
    unmount();
    render(<WatchlistChips lists={[{ id: "w1", name: "Ideen" }, { id: "w 2", name: "Dividenden" }]} />);
    expect(screen.getByRole("link", { name: "Ideen" }).getAttribute("href")).toBe("/watchlists?list=w1");
    expect(screen.getByRole("link", { name: "Dividenden" }).getAttribute("href")).toBe("/watchlists?list=w%202");
  });
});

describe("WatchlistCard", () => {
  const ENTRY: WatchlistCardEntry = {
    id: "e1",
    watchlistId: "w1",
    watchlistName: "Ideen",
    note: "Zeile 1\nZeile 2",
    dateAdded: "2026-10-01",
    source: "MCP",
    sinceAdded: "0.1",
  };
  const LISTS = [{ id: "w1", name: "Ideen" }];

  it("renders nothing when the Security is on no list", () => {
    const { container } = render(<WatchlistCard entries={[]} lists={LISTS} security={SECURITY} today="2026-10-28" />);
    expect(container.textContent).toBe("");
  });

  it("shows list link, date added, change since added, full note and via Claude; – without a change", () => {
    render(
      <WatchlistCard
        entries={[ENTRY, { ...ENTRY, id: "e2", watchlistId: "w2", watchlistName: "Später", source: "APP", sinceAdded: null, note: "" }]}
        lists={LISTS}
        security={SECURITY}
        today="2026-10-28"
      />,
    );
    const card = screen.getByRole("region", { name: "Auf Watchlists" });
    expect(within(card).getByRole("link", { name: "Ideen" }).getAttribute("href")).toBe("/watchlists?list=w1");
    const shown = (card.textContent ?? "").replace(/\s/g, " ");
    expect(shown).toContain("Aufgenommen 01.10.2026 · seit Aufnahme +10,00 %");
    expect(shown).toContain("seit Aufnahme –");
    const note = within(card).getByText(/Zeile 1/);
    expect(note.textContent).toBe("Zeile 1\nZeile 2");
    expect(within(card).getAllByText("via Claude")).toHaveLength(1);
  });

  it("Bearbeiten opens the entry dialog and submits the new note", async () => {
    update.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof updateWatchlistEntryAction>>);
    const user = userEvent.setup({ delay: null });
    render(<WatchlistCard entries={[ENTRY]} lists={LISTS} security={SECURITY} today="2026-10-28" />);
    await user.click(screen.getByRole("button", { name: "Bearbeiten – Ideen" }));
    const dialog = await screen.findByRole("dialog", { name: "Eintrag bearbeiten" });
    const note = within(dialog).getByRole("textbox", { name: "Notiz" });
    expect((note as HTMLTextAreaElement).value).toBe("Zeile 1\nZeile 2");
    await user.clear(note);
    await user.type(note, "Neu");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(dialog);
    expect(formEntries(update.mock.calls[0][1])).toEqual({ entryId: "e1", watchlistId: "w1", note: "Neu", dateAdded: "2026-10-01" });
  }, 15_000);
});
