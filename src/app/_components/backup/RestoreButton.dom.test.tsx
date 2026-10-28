// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseFile, formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { RestoreButton } from "./RestoreButton";

const restoreAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/_actions/backup", () => ({ restoreAction }));

registerDomCleanup();

const BACKUP = "depotmanagement-export-20261026-130000.json";
const exportFile = () => new File(['{"schemaVersion":1}'], "sicherung.json", { type: "application/json" });

beforeEach(() => {
  restoreAction.mockReset();
});

async function openDialog() {
  const user = userEvent.setup({ delay: null });
  render(<RestoreButton />);
  await user.click(screen.getByRole("button", { name: "Wiederherstellen" }));
  const dialog = await screen.findByRole("dialog", { name: "Daten wiederherstellen" });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  const confirm = within(dialog).getByLabelText("Zur Bestätigung WIEDERHERSTELLEN eingeben") as HTMLInputElement;
  const submit = within(dialog).getByRole("button", { name: "Wiederherstellen" }) as HTMLButtonElement;
  return { user, dialog, input, confirm, submit };
}

describe("RestoreButton", () => {
  it("states what happens and accepts JSON files", async () => {
    const { dialog, input } = await openDialog();
    expect(dialog.textContent).toContain(
      "Alle Daten werden durch den Inhalt der Datei ersetzt. Vorher wird automatisch ein Export der aktuellen Daten im Sicherungsordner abgelegt. Verbundene Apps (z. B. Claude) müssen danach neu verbunden werden.",
    );
    expect(input.getAttribute("accept")).toBe(".json,application/json");
    expect(within(dialog).getByText("Exportdatei wählen")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeTruthy();
  });

  it("stays disabled until a file is chosen and the exact text is typed", async () => {
    const { user, dialog, input, confirm, submit } = await openDialog();
    expect(submit.disabled).toBe(true);
    await user.type(confirm, "WIEDERHERSTELLEN");
    expect(submit.disabled).toBe(true);
    await user.clear(confirm);
    chooseFile(input, exportFile());
    expect(within(dialog).getByText("sicherung.json")).toBeTruthy();
    expect(submit.disabled).toBe(true);
    for (const wrong of ["wiederherstellen", "WIEDERHERSTELLE", "WIEDERHERSTELLEN ", " WIEDERHERSTELLEN"]) {
      await user.clear(confirm);
      await user.type(confirm, wrong);
      expect(submit.disabled).toBe(true);
    }
    await user.clear(confirm);
    await user.type(confirm, "WIEDERHERSTELLEN");
    expect(submit.disabled).toBe(false);
  });

  it("submits the file on Enter, closes and shows the automatic export's name", async () => {
    restoreAction.mockResolvedValue({ ok: true, backupFileName: BACKUP });
    const { user, input, confirm } = await openDialog();
    chooseFile(input, exportFile());
    await user.type(confirm, "WIEDERHERSTELLEN{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(restoreAction).toHaveBeenCalledTimes(1);
    expect((formEntries(restoreAction.mock.calls[0][1] as FormData).file as File).name).toBe("sicherung.json");
    expect(screen.getByRole("status").textContent).toBe(`Daten wiederhergestellt. Automatischer Export: ${BACKUP}`);
  });

  it.each([
    [{ reason: "not-json" }, "Die Datei ist keine JSON-Datei."],
    [{ reason: "schema-invalid", detail: "transactions.3.amount" }, "Die Datei ist keine gültige Exportdatei. Stelle: transactions.3.amount"],
    [{ reason: "inconsistent", detail: "transactions.3.depotId" }, "Die Datei ist in sich widersprüchlich. Stelle: transactions.3.depotId"],
    [{ reason: "version-unsupported" }, "Die Datei stammt aus einer neueren Version von DepotManagement und kann nicht gelesen werden."],
    [{ reason: "backup-failed" }, "Der automatische Export konnte nicht gespeichert werden. Es wurde nichts geändert."],
    [{ reason: "unauthorized" }, "Sitzung abgelaufen. Bitte erneut anmelden."],
  ])("shows the German error for %o and keeps the file and the text", async (failure, message) => {
    restoreAction.mockResolvedValue({ ok: false, ...failure });
    const { user, dialog, input, confirm, submit } = await openDialog();
    chooseFile(input, exportFile());
    await user.type(confirm, "WIEDERHERSTELLEN");
    await user.click(submit);
    expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(screen.getByRole("dialog", { name: "Daten wiederherstellen" })).toBeTruthy();
    expect(within(dialog).getByText("sicherung.json")).toBeTruthy();
    expect(input.files?.[0]?.name).toBe("sicherung.json");
    expect(confirm.value).toBe("WIEDERHERSTELLEN");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the connection error when the action is rejected", async () => {
    restoreAction.mockRejectedValue(new Error("network"));
    const { user, dialog, input, confirm, submit } = await openDialog();
    chooseFile(input, exportFile());
    await user.type(confirm, "WIEDERHERSTELLEN");
    await user.click(submit);
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("disables everything while the restore runs", async () => {
    let release: (value: unknown) => void = () => undefined;
    restoreAction.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { user, dialog, input, confirm, submit } = await openDialog();
    chooseFile(input, exportFile());
    await user.type(confirm, "WIEDERHERSTELLEN");
    await user.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(confirm.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Abbrechen" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Daten wiederherstellen" })).toBeTruthy();
    release({ ok: true, backupFileName: BACKUP });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Abbrechen and on Esc without calling the action, and starts empty again", async () => {
    const { user, dialog, input } = await openDialog();
    chooseFile(input, exportFile());
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Wiederherstellen" }));
    const reopened = await screen.findByRole("dialog", { name: "Daten wiederherstellen" });
    expect(within(reopened).getByText("Keine Datei gewählt")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(restoreAction).not.toHaveBeenCalled();
  });
});
