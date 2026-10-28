// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { addWatchlistEntryAction, removeWatchlistEntryAction, updateWatchlistEntryAction } from "@/app/_actions/watchlists";
import type { SecuritySummary } from "@/modules/ledger";
import { AddToWatchlistButton, AddWatchlistEntryButton, EditWatchlistEntryDialog } from "./WatchlistEntryDialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_actions/watchlists", () => ({
  createWatchlistAction: vi.fn(),
  renameWatchlistAction: vi.fn(),
  deleteWatchlistAction: vi.fn(),
  addWatchlistEntryAction: vi.fn(),
  updateWatchlistEntryAction: vi.fn(),
  removeWatchlistEntryAction: vi.fn(),
}));

registerDomCleanup();

/** Autocomplete and typing are slow in happy-dom under a loaded full-suite run. */
const SLOW = 15_000;

const add = vi.mocked(addWatchlistEntryAction);
const update = vi.mocked(updateWatchlistEntryAction);
const remove = vi.mocked(removeWatchlistEntryAction);

beforeEach(() => {
  add.mockReset();
  update.mockReset();
  remove.mockReset();
});

const SAP: SecuritySummary = { id: "s1", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" };
const OK_ADD = { ok: true } as Awaited<ReturnType<typeof addWatchlistEntryAction>>;

async function openAdd() {
  const user = userEvent.setup({ delay: null });
  render(<AddWatchlistEntryButton watchlistId="w1" securities={[SAP]} today="2026-10-28" />);
  await user.click(screen.getByRole("button", { name: "Wertpapier hinzufügen" }));
  const dialog = await screen.findByRole("dialog", { name: "Wertpapier hinzufügen" });
  return { user, dialog };
}

describe("AddWatchlistEntryButton", () => {
  it("adds an existing Security with note and date added (default today)", async () => {
    add.mockResolvedValue(OK_ADD);
    const { user, dialog } = await openAdd();
    expect((within(dialog).getByLabelText(/Aufgenommen am/) as HTMLInputElement).value).toBe("2026-10-28");
    await user.click(within(dialog).getByRole("combobox", { name: "Security" }));
    await user.click(await screen.findByRole("option", { name: "SAP SE (DE0007164600)" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Notiz" }), "KGV niedrig");
    await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    await waitForElementToBeRemoved(dialog);
    expect(formEntries(add.mock.calls[0][1])).toEqual({ watchlistId: "w1", securityId: "s1", note: "KGV niedrig", dateAdded: "2026-10-28" });
  }, SLOW);

  it("offers 'Neue Security anlegen' with identifier, name and type, and shows ledger reasons on the fields", async () => {
    add.mockResolvedValueOnce({ ok: false, reason: "isin-invalid" });
    const { user, dialog } = await openAdd();
    await user.click(within(dialog).getByRole("combobox", { name: "Security" }));
    await user.click(await screen.findByRole("option", { name: "Neue Security anlegen" }));
    await user.type(within(dialog).getByRole("textbox", { name: "ISIN oder Krypto-Symbol" }), "DE000BAD0000");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Bad AG");
    await user.click(within(dialog).getByRole("combobox", { name: "Art" }));
    await user.click(await screen.findByRole("option", { name: "Aktie" }));
    await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    expect(await within(dialog).findByText("Bitte eine gültige ISIN eingeben.")).toBeDefined();
    expect(formEntries(add.mock.calls[0][1])).toMatchObject({
      watchlistId: "w1",
      newSecurity: "1",
      securityIdentifier: "DE000BAD0000",
      securityName: "Bad AG",
      assetType: "STOCK",
    });
  }, SLOW);

  it("shows 'Steht schon auf dieser Liste' on the Security field", async () => {
    add.mockResolvedValue({ ok: false, reason: "already-on-list" });
    const { user, dialog } = await openAdd();
    await user.click(within(dialog).getByRole("combobox", { name: "Security" }));
    await user.click(await screen.findByRole("option", { name: "SAP SE (DE0007164600)" }));
    await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    expect(await within(dialog).findByText("Steht schon auf dieser Liste")).toBeDefined();
  }, SLOW);
});

const ENTRY = {
  id: "e1",
  watchlistId: "w1",
  note: "Erste Zeile\nZweite",
  dateAdded: "2026-10-01",
  security: { name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null },
};
const LISTS = [
  { id: "w1", name: "Ideen" },
  { id: "w2", name: "Dividenden" },
];

function renderEdit(onClose = vi.fn()) {
  render(<EditWatchlistEntryDialog open onClose={onClose} formKey={1} entry={ENTRY} lists={LISTS} today="2026-10-28" />);
  return { onClose, dialog: screen.getByRole("dialog", { name: "Eintrag bearbeiten" }) };
}

describe("EditWatchlistEntryDialog", () => {
  it("saves note, date and a move to another list", async () => {
    update.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof updateWatchlistEntryAction>>);
    const user = userEvent.setup({ delay: null });
    const { dialog, onClose } = renderEdit();
    expect((within(dialog).getByRole("textbox", { name: "Notiz" }) as HTMLTextAreaElement).value).toBe("Erste Zeile\nZweite");
    await user.click(within(dialog).getByRole("combobox", { name: "Watchlist" }));
    await user.click(await screen.findByRole("option", { name: "Dividenden" }));
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(formEntries(update.mock.calls[0][1])).toEqual({
      entryId: "e1",
      watchlistId: "w2",
      note: "Erste Zeile\nZweite",
      dateAdded: "2026-10-01",
    });
  });

  it("shows a refused move on the list field", async () => {
    update.mockResolvedValue({ ok: false, reason: "already-on-list" });
    const user = userEvent.setup({ delay: null });
    const { dialog } = renderEdit();
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Steht schon auf dieser Liste")).toBeDefined();
  });

  it("removes the entry with 'Entfernen'", async () => {
    remove.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    const { dialog, onClose } = renderEdit();
    await user.click(within(dialog).getByRole("button", { name: "Entfernen" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(remove).toHaveBeenCalledWith("e1");
  });
});

describe("AddToWatchlistButton", () => {
  const LISTS = [
    { id: "w1", name: "Ideen" },
    { id: "w2", name: "Dividenden" },
  ];

  async function openTo(lists = LISTS, onLists: string[] = []) {
    const user = userEvent.setup({ delay: null });
    render(<AddToWatchlistButton security={SAP} lists={lists} onLists={onLists} today="2026-10-28" />);
    await user.click(screen.getByRole("button", { name: "Zur Watchlist" }));
    const dialog = await screen.findByRole("dialog", { name: "Zur Watchlist" });
    return { user, dialog };
  }

  it("adds the fixed Security to the first list not containing it, with note and date added", async () => {
    add.mockResolvedValue(OK_ADD);
    const { user, dialog } = await openTo(LISTS, ["w1"]);
    expect(within(dialog).getByText("SAP SE")).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: /Watchlist/ }).textContent).toBe("Dividenden");
    expect((within(dialog).getByLabelText(/Aufgenommen am/) as HTMLInputElement).value).toBe("2026-10-28");
    await user.type(within(dialog).getByRole("textbox", { name: "Notiz" }), "Idee");
    await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    await waitForElementToBeRemoved(dialog);
    expect(formEntries(add.mock.calls[0][1])).toEqual({ securityId: "s1", watchlistId: "w2", note: "Idee", dateAdded: "2026-10-28" });
  }, SLOW);

  it("shows a duplicate as an Alert and keeps the dialog open", async () => {
    add.mockResolvedValue({ ok: false, reason: "already-on-list" });
    const { user, dialog } = await openTo();
    await user.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Steht schon auf dieser Liste");
    expect(screen.getByRole("dialog", { name: "Zur Watchlist" })).toBeTruthy();
  }, SLOW);

  it("without lists links to Watchlist anlegen", async () => {
    const { dialog } = await openTo([]);
    expect(within(dialog).getByRole("link", { name: "Watchlist anlegen" }).getAttribute("href")).toBe("/watchlists");
    expect(within(dialog).queryByRole("button", { name: "Hinzufügen" })).toBeNull();
  });
});
