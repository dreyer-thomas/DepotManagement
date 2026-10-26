// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { saveManualPriceAction } from "@/app/_actions/prices";
import { ManualPriceButton } from "./ManualPriceDialog";

vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveManualPriceAction);
const sap = { id: "s1", name: "SAP SE" };

beforeEach(() => {
  save.mockReset();
});

async function openDialog() {
  const user = userEvent.setup({ delay: null });
  render(<ManualPriceButton security={sap} today="2026-10-26" />);
  await user.click(screen.getByRole("button", { name: "Kurs manuell eintragen – SAP SE" }));
  const dialog = await screen.findByRole("dialog", { name: "Kurs manuell eintragen" });
  return { user, dialog };
}

describe("ManualPriceButton", () => {
  it("defaults the date to today, submits the German price and closes on success", async () => {
    save.mockResolvedValue({ ok: true });
    const { user, dialog } = await openDialog();
    const date = within(dialog).getByLabelText(/Datum/) as HTMLInputElement;
    expect(date.value).toBe("2026-10-26");
    expect(date.max).toBe("2026-10-26");
    await user.type(within(dialog).getByLabelText(/Kurs in €/), "12,34");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(formEntries(save.mock.calls[0][1])).toEqual({ securityId: "s1", date: "2026-10-26", price: "12,34" });
  });

  it("shows a field error and keeps the input on an invalid price", async () => {
    save.mockResolvedValue({ ok: false, reason: "price-invalid" });
    const { user, dialog } = await openDialog();
    const price = within(dialog).getByLabelText(/Kurs in €/) as HTMLInputElement;
    await user.type(price, "0");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte einen Kurs größer als 0 eingeben, z. B. 12,34.")).toBeTruthy();
    expect(price.value).toBe("0");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the date error and the connection message", async () => {
    save.mockResolvedValueOnce({ ok: false, reason: "date-invalid" }).mockRejectedValueOnce(new Error("offline"));
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Kurs in €/), "10");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte ein gültiges Datum bis heute wählen.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });
});
