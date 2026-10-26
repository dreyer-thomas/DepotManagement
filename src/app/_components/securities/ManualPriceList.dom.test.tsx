// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { deleteManualPriceAction, updateManualPriceAction } from "@/app/_actions/prices";
import { ManualPriceList } from "./ManualPriceList";

vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

registerDomCleanup();

const update = vi.mocked(updateManualPriceAction);
const remove = vi.mocked(deleteManualPriceAction);
const sap = { id: "s1", name: "SAP SE" };
const prices = [{ id: "p1", date: "2026-10-20", price: "1234.5" }];

beforeEach(() => {
  update.mockReset();
  remove.mockReset();
});

function setup() {
  const user = userEvent.setup({ delay: null });
  render(<ManualPriceList security={sap} prices={prices} today="2026-10-26" />);
  return user;
}

describe("ManualPriceList", () => {
  it("renders nothing without manual Prices", () => {
    const { container } = render(<ManualPriceList security={sap} prices={[]} today="2026-10-26" />);
    expect(container.textContent).toBe("");
  });

  it("opens the edit dialog prefilled and submits the row id; closes on success", async () => {
    update.mockResolvedValue({ ok: true });
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Manuellen Kurs vom 20.10.2026 bearbeiten – SAP SE" }));
    const dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs bearbeiten" });
    const date = within(dialog).getByLabelText(/Datum/) as HTMLInputElement;
    const price = within(dialog).getByLabelText(/Kurs in €/) as HTMLInputElement;
    expect(date.value).toBe("2026-10-20");
    expect(date.max).toBe("2026-10-26");
    expect(price.value).toBe("1234,5");
    await user.clear(price);
    await user.type(price, "13,5");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(formEntries(update.mock.calls[0][1])).toEqual({ priceId: "p1", date: "2026-10-20", price: "13,5" });
  });

  it("shows date-taken at the date field and keeps the dialog open", async () => {
    update.mockResolvedValue({ ok: false, reason: "date-taken" });
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Manuellen Kurs vom 20.10.2026 bearbeiten – SAP SE" }));
    const dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs bearbeiten" });
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Für dieses Datum gibt es bereits einen manuellen Kurs.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the price-not-found alert when the edited row is gone", async () => {
    update.mockResolvedValue({ ok: false, reason: "not-found" });
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Manuellen Kurs vom 20.10.2026 bearbeiten – SAP SE" }));
    const dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs bearbeiten" });
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Manueller Kurs nicht gefunden.");
  });

  it("starts from the stored values again when reopened after cancelling", async () => {
    update.mockResolvedValue({ ok: false, reason: "price-invalid" });
    const user = setup();
    const open = () => user.click(screen.getByRole("button", { name: "Manuellen Kurs vom 20.10.2026 bearbeiten – SAP SE" }));
    await open();
    let dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs bearbeiten" });
    const price = within(dialog).getByLabelText(/Kurs in €/) as HTMLInputElement;
    await user.clear(price);
    await user.type(price, "0");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte einen Kurs größer als 0 eingeben, z. B. 12,34.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await open();
    dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs bearbeiten" });
    expect((within(dialog).getByLabelText(/Kurs in €/) as HTMLInputElement).value).toBe("1234,5");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).queryByText("Bitte einen Kurs größer als 0 eingeben, z. B. 12,34.")).toBeNull();
  });

  it("deletes after confirming and closes on success", async () => {
    remove.mockResolvedValue({ ok: true });
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Manuellen Kurs vom 20.10.2026 löschen – SAP SE" }));
    const dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs löschen" });
    expect(within(dialog).getByText("Manuellen Kurs vom 20.10.2026 für SAP SE löschen?")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(remove).toHaveBeenCalledExactlyOnceWith("p1");
  });

  it("keeps the confirm dialog open with an error alert on failure; Abbrechen deletes nothing", async () => {
    remove.mockResolvedValueOnce({ ok: false, reason: "not-found" }).mockRejectedValueOnce(new Error("offline"));
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Manuellen Kurs vom 20.10.2026 löschen – SAP SE" }));
    const dialog = await screen.findByRole("dialog", { name: "Manuellen Kurs löschen" });
    await user.click(within(dialog).getByRole("button", { name: "Löschen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Manueller Kurs nicht gefunden.");
    await user.click(within(dialog).getByRole("button", { name: "Löschen" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen."),
    );
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
