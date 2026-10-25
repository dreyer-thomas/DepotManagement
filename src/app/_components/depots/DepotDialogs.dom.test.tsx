// @vitest-environment happy-dom
import { render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { archiveDepotAction, unarchiveDepotAction } from "@/app/_actions/depots";
import { ArchiveDepotButton, UnarchiveDepotButton } from "./DepotDialogs";

vi.mock("@/app/_actions/depots", () => ({
  archiveDepotAction: vi.fn(),
  unarchiveDepotAction: vi.fn(),
  createDepotAction: vi.fn(),
  renameDepotAction: vi.fn(),
  deleteDepotAction: vi.fn(),
}));

registerDomCleanup();

const archive = vi.mocked(archiveDepotAction);
const unarchive = vi.mocked(unarchiveDepotAction);

beforeEach(() => {
  archive.mockReset();
  unarchive.mockReset();
});

const depot = { id: "d1", name: "Hauptdepot", archivable: true };

async function openArchiveDialog() {
  const user = userEvent.setup({ delay: null });
  render(<ArchiveDepotButton depot={depot} />);
  await user.click(screen.getByRole("button", { name: "„Hauptdepot“ archivieren" }));
  const dialog = await screen.findByRole("dialog", { name: "Depot archivieren" });
  return { user, dialog };
}

describe("ArchiveDepotButton", () => {
  it("opens the confirmation with focus on Abbrechen and closes after a successful archive", async () => {
    archive.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof archiveDepotAction>>);
    const { user, dialog } = await openArchiveDialog();
    expect(dialog.textContent).toContain("Depot „Hauptdepot“ archivieren?");
    // In a browser MUI's focus trap moves focus to the dialog while it fades in, overriding `autoFocus`;
    // simulate that, so only the focus hook that runs once the dialog has entered puts it back on Abbrechen.
    const trapRoot = dialog.closest<HTMLElement>('[tabindex="-1"]')!;
    trapRoot.focus();
    expect(document.activeElement).toBe(trapRoot);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" })));

    await user.click(screen.getByRole("button", { name: "Archivieren" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(formEntries(archive.mock.calls[0][1])).toEqual({ id: "d1" });
  });

  it("keeps the dialog open and shows the German failure in an Alert", async () => {
    archive.mockResolvedValue({ ok: false, reason: "depot-not-flat" });
    const { user, dialog } = await openArchiveDialog();
    await user.click(screen.getByRole("button", { name: "Archivieren" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Depot hat noch Positionen oder Guthaben.");
    expect(dialog.isConnected).toBe(true);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("does not open while the Depot is not archivable", () => {
    render(<ArchiveDepotButton depot={{ ...depot, archivable: false }} />);
    expect((screen.getByRole("button", { name: "„Hauptdepot“ archivieren" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("UnarchiveDepotButton", () => {
  it("submits the Depot id, shows a failure Alert, and clears it after success", async () => {
    unarchive
      .mockResolvedValueOnce({ ok: false, reason: "not-found" })
      .mockResolvedValueOnce({ ok: true } as Awaited<ReturnType<typeof unarchiveDepotAction>>);
    const user = userEvent.setup({ delay: null });
    render(<UnarchiveDepotButton depot={{ id: "d2", name: "Altdepot" }} />);
    const button = screen.getByRole("button", { name: "„Altdepot“ reaktivieren" });

    await user.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe("Depot nicht gefunden.");
    expect(formEntries(unarchive.mock.calls[0][1])).toEqual({ id: "d2" });

    await user.click(button);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(unarchive).toHaveBeenCalledTimes(2);
    expect(formEntries(unarchive.mock.calls[1][1])).toEqual({ id: "d2" });
  });
});
