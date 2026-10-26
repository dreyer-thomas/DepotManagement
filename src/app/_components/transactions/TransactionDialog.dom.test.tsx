// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { saveTransactionAction } from "@/app/_actions/transactions";
import type { SecuritySummary } from "@/modules/ledger";
import { NewTransactionButton, TransactionDialog } from "./TransactionDialog";

vi.mock("@/app/_actions/transactions", () => ({
  saveTransactionAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveTransactionAction);

beforeEach(() => {
  save.mockReset();
});

const depot = { id: "d1", name: "Hauptdepot" };
const securities: SecuritySummary[] = [
  { id: "s1", name: "Welt ETF", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF" },
];

const input = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

/** Opens "Neue Buchung" and fills a BUY of a new Security with an invalid quantity. */
async function fillNewSecurityBuy() {
  const user = userEvent.setup({ delay: null });
  render(<NewTransactionButton depot={depot} securities={securities} today="2024-03-01" />);
  await user.click(screen.getByRole("button", { name: "Neue Buchung" }));
  const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });

  await user.click(within(dialog).getByRole("button", { name: "Kauf" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Security" }));
  await user.click(await screen.findByRole("option", { name: "Neue Security anlegen" }));
  await user.type(input("ISIN oder Krypto-Symbol"), "IE00B5BMR087");
  await user.type(input("Name"), "Synthetik S&P ETF");
  await user.click(within(dialog).getByRole("combobox", { name: "Art" }));
  await user.click(await screen.findByRole("option", { name: "ETF" }));
  fireEvent.change(dialog.querySelector('input[name="date"]')!, { target: { value: "2024-02-15" } });
  await user.type(input("Stück"), "0");
  await user.type(input("Kurs"), "100,50");
  await user.type(input("Gebühren"), "1,00");
  await user.type(input("Steuern"), "0,25");
  return { user, dialog };
}

describe("NewTransactionButton", () => {
  it("keeps every entered value after a failed submit and shows the field error (DW-2)", async () => {
    save.mockResolvedValue({ ok: false, reason: "quantity-invalid" });
    const { user, dialog } = await fillNewSecurityBuy();

    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toMatchObject({
      depotId: "d1",
      type: "BUY",
      newSecurity: "1",
      securityIdentifier: "IE00B5BMR087",
      securityName: "Synthetik S&P ETF",
      assetType: "ETF",
      date: "2024-02-15",
      quantity: "0",
      price: "100,50",
      fee: "1,00",
      tax: "0,25",
    });

    expect(await within(dialog).findByText("Bitte eine Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.")).toBeTruthy();
    expect(dialog.isConnected).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Kauf" }).getAttribute("aria-pressed")).toBe("true");
    expect((within(dialog).getByRole("combobox", { name: "Security" }) as HTMLInputElement).value).toBe("Neue Security anlegen");
    expect(input("ISIN oder Krypto-Symbol").value).toBe("IE00B5BMR087");
    expect(input("Name").value).toBe("Synthetik S&P ETF");
    expect(within(dialog).getByRole("combobox", { name: "Art" }).textContent).toBe("ETF");
    expect((dialog.querySelector('input[name="assetType"]') as HTMLInputElement).value).toBe("ETF");
    expect((dialog.querySelector('input[name="date"]') as HTMLInputElement).value).toBe("2024-02-15");
    expect(input("Stück").value).toBe("0");
    expect(input("Kurs").value).toBe("100,50");
    expect(input("Gebühren").value).toBe("1,00");
    expect(input("Steuern").value).toBe("0,25");

    // A resubmit sends the same values again (nothing was cleared from the form).
    save.mockResolvedValue({ ok: false, reason: "quantity-invalid" });
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(formEntries(save.mock.calls[1][1])).toEqual(formEntries(save.mock.calls[0][1]));
  }, 20_000);

  it("closes the dialog after a successful booking", async () => {
    save.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof saveTransactionAction>>);
    const { user, dialog } = await fillNewSecurityBuy();
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(save).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe("TransactionDialog", () => {
  it("preselects the given Security in a new Transaction", async () => {
    save.mockResolvedValue({ ok: false, reason: "quantity-invalid" });
    const user = userEvent.setup({ delay: null });
    render(
      <TransactionDialog open onClose={() => {}} formKey={1} depot={depot} securities={securities} today="2024-03-01" security={securities[0]} />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((within(dialog).getByRole("combobox", { name: "Security" }) as HTMLInputElement).value).toBe("Welt ETF (IE00B4L5Y983)");
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toMatchObject({ depotId: "d1", type: "BUY", securityId: "s1" });
  }, 20_000);
});

describe("TransactionDialog holding correction", () => {
  it("offers Bestandskorrektur last with signed Stück, Einstandskurs and no cash effect", async () => {
    save.mockResolvedValue({ ok: false, reason: "quantity-invalid" });
    const user = userEvent.setup({ delay: null });
    render(<TransactionDialog open onClose={() => {}} formKey={1} depot={depot} securities={securities} today="2024-03-01" security={securities[0]} />);
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    const typeButtons = within(dialog)
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) => text === "Auszahlung" || text === "Bestandskorrektur");
    expect(typeButtons).toEqual(["Auszahlung", "Bestandskorrektur"]);
    await user.click(within(dialog).getByRole("button", { name: "Bestandskorrektur" }));
    await user.type(input("Stück (±)"), "-2");
    expect(input("Einstandskurs je Stück")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: "Gebühren" })).toBeNull();
    expect(within(dialog).getByText(/^Cash-Effekt: \+0,00\s€$/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toMatchObject({ type: "ADJUSTMENT", securityId: "s1", quantity: "-2" });
  }, 20_000);
});
