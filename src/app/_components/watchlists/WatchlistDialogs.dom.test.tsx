// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { createWatchlistAction, deleteWatchlistAction, renameWatchlistAction } from "@/app/_actions/watchlists";
import { CreateWatchlistButton, DeleteWatchlistButton, RenameWatchlistButton } from "./WatchlistDialogs";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/app/_actions/watchlists", () => ({
  createWatchlistAction: vi.fn(),
  renameWatchlistAction: vi.fn(),
  deleteWatchlistAction: vi.fn(),
  addWatchlistEntryAction: vi.fn(),
  updateWatchlistEntryAction: vi.fn(),
  removeWatchlistEntryAction: vi.fn(),
}));

registerDomCleanup();

const create = vi.mocked(createWatchlistAction);
const rename = vi.mocked(renameWatchlistAction);
const remove = vi.mocked(deleteWatchlistAction);

beforeEach(() => {
  push.mockReset();
  create.mockReset();
  rename.mockReset();
  remove.mockReset();
});

describe("CreateWatchlistButton", () => {
  it("creates the list and opens it", async () => {
    create.mockResolvedValue({ ok: true, watchlist: { id: "w1", name: "Ideen", position: 1, entryCount: 0 } });
    const user = userEvent.setup({ delay: null });
    render(<CreateWatchlistButton />);
    await user.click(screen.getByRole("button", { name: "Watchlist anlegen" }));
    const dialog = await screen.findByRole("dialog", { name: "Watchlist anlegen" });
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ideen");
    await user.click(screen.getByRole("button", { name: "Anlegen" }));
    await waitForElementToBeRemoved(dialog);
    expect(formEntries(create.mock.calls[0][1])).toEqual({ name: "Ideen" });
    expect(push).toHaveBeenCalledWith("/watchlists?list=w1", { scroll: false });
  });

  it("shows a duplicate name on the name field and keeps the input", async () => {
    create.mockResolvedValue({ ok: false, reason: "name-taken" });
    const user = userEvent.setup({ delay: null });
    render(<CreateWatchlistButton />);
    await user.click(screen.getByRole("button", { name: "Watchlist anlegen" }));
    const input = await screen.findByRole("textbox", { name: "Name" });
    await user.type(input, "ideen");
    await user.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(await screen.findByText("Name ist schon vergeben")).toBeDefined();
    expect((input as HTMLInputElement).value).toBe("ideen");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("RenameWatchlistButton", () => {
  it("submits the id and the new name", async () => {
    rename.mockResolvedValue({ ok: true, watchlist: { id: "w1", name: "Neu", position: 1, entryCount: 0 } });
    const user = userEvent.setup({ delay: null });
    render(<RenameWatchlistButton watchlist={{ id: "w1", name: "Ideen" }} />);
    await user.click(screen.getByRole("button", { name: "„Ideen“ umbenennen" }));
    const dialog = await screen.findByRole("dialog", { name: "Watchlist umbenennen" });
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "Neu");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(dialog);
    expect(formEntries(rename.mock.calls[0][1])).toEqual({ watchlistId: "w1", name: "Neu" });
  });
});

describe("DeleteWatchlistButton", () => {
  it("names the list and its entry count, deletes and returns to the Watchlists page", async () => {
    remove.mockResolvedValue({ ok: true, deleted: { entries: 3 } });
    const user = userEvent.setup({ delay: null });
    render(<DeleteWatchlistButton watchlist={{ id: "w1", name: "Ideen", entryCount: 3 }} />);
    await user.click(screen.getByRole("button", { name: "„Ideen“ löschen" }));
    const dialog = await screen.findByRole("dialog", { name: "Watchlist löschen" });
    expect(dialog.textContent).toContain("Watchlist „Ideen“ mit 3 Einträgen löschen?");
    await user.click(screen.getByRole("button", { name: "Löschen" }));
    await waitForElementToBeRemoved(dialog);
    expect(formEntries(remove.mock.calls[0][1])).toEqual({ watchlistId: "w1" });
    expect(push).toHaveBeenCalledWith("/watchlists", { scroll: false });
  });
});
