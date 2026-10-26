// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseFile, formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { LogoProvider } from "./LogoContext";
import { LogoUploadButton } from "./LogoUploadDialog";

const uploadLogoAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/_actions/logos", () => ({ uploadLogoAction }));

registerDomCleanup();

const security = { id: "s1", name: "SAP SE" };
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sap.png", { type: "image/png" });

beforeEach(() => {
  uploadLogoAction.mockReset();
});

async function openDialog(versions: Record<string, string> = {}) {
  const user = userEvent.setup({ delay: null });
  render(
    <LogoProvider versions={versions}>
      <LogoUploadButton security={security} />
    </LogoProvider>,
  );
  await user.click(screen.getByRole("button", { name: /– SAP SE$/ }));
  const dialog = await screen.findByRole("dialog", { name: "Logo hochladen" });
  return { user, dialog, input: dialog.querySelector('input[type="file"]') as HTMLInputElement };
}

describe("LogoUploadButton", () => {
  it("is labelled by whether a logo is stored", () => {
    const { unmount } = render(<LogoUploadButton security={security} />);
    expect(screen.getByRole("button", { name: "Logo hochladen – SAP SE" }).textContent).toBe("Logo hochladen");
    unmount();
    render(
      <LogoProvider versions={{ s1: "1" }}>
        <LogoUploadButton security={security} />
      </LogoProvider>,
    );
    expect(screen.getByRole("button", { name: "Logo ersetzen – SAP SE" }).textContent).toBe("Logo ersetzen");
  });

  it("offers an image file input with the hint and both actions", async () => {
    const { dialog, input } = await openDialog();
    expect(input.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
    expect(within(dialog).getByText("PNG, JPEG oder WebP, höchstens 1 MB.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Hochladen" })).toBeTruthy();
  });

  it("submits the Security id and the chosen file, then closes on success", async () => {
    uploadLogoAction.mockResolvedValue({ ok: true });
    const { user, dialog, input } = await openDialog();
    const file = png();
    chooseFile(input, file);
    expect(within(dialog).getByText("sap.png")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Hochladen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const entries = formEntries(uploadLogoAction.mock.calls[0][1] as FormData);
    expect(entries.securityId).toBe("s1");
    expect((entries.file as File).name).toBe("sap.png");
  });

  it.each([
    ["file-type", "Bitte eine PNG-, JPEG- oder WebP-Datei wählen."],
    ["file-too-large", "Die Datei ist größer als 1 MB."],
    ["file-missing", "Bitte eine Bilddatei wählen."],
    ["unauthorized", "Sitzung abgelaufen. Bitte erneut anmelden."],
    ["not-found", "Wertpapier nicht gefunden."],
  ])("shows the German error for %s and stays open", async (reason, message) => {
    uploadLogoAction.mockResolvedValue({ ok: false, reason });
    const { user, dialog, input } = await openDialog();
    chooseFile(input, png());
    await user.click(within(dialog).getByRole("button", { name: "Hochladen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole("dialog", { name: "Logo hochladen" })).toBeTruthy();
  });

  it("shows the connection error when the action is rejected", async () => {
    uploadLogoAction.mockRejectedValue(new Error("network"));
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Hochladen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });
});
