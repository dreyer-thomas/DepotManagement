// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { deleteIsinChangeAction, saveIsinChangeAction } from "@/app/_actions/corporate-actions";
import { PositionsTable } from "@/app/_components/positions/PositionsTable";
import type { IsinChangeRecord, PositionRecord, SecuritySummary } from "@/modules/ledger";

vi.mock("@/app/_actions/corporate-actions", () => ({
  saveSplitAction: vi.fn(),
  deleteSplitAction: vi.fn(),
  saveIsinChangeAction: vi.fn(),
  deleteIsinChangeAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveIsinChangeAction);
const remove = vi.mocked(deleteIsinChangeAction);

beforeEach(() => {
  save.mockReset();
  remove.mockReset();
});

const oldName: SecuritySummary = { id: "s1", name: "Altname Software SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" };
const newName: SecuritySummary = { id: "s2", name: "Neuname Software SE", isin: "DE000SYN0013", cryptoSymbol: null, assetType: "STOCK" };
const other: SecuritySummary = { id: "s3", name: "Synthetik Gamma AG", isin: "DE000SYN0003", cryptoSymbol: null, assetType: "STOCK" };

const isinChanges: IsinChangeRecord[] = [
  { id: "ic1", oldSecurity: oldName, newSecurity: newName, date: "2024-05-02", oldQuantity: "12", newQuantity: "6" },
  { id: "ic2", oldSecurity: other, newSecurity: newName, date: "2024-06-01", oldQuantity: "1", newQuantity: "1" },
];

const position = (security: SecuritySummary): PositionRecord => ({
  security,
  quantity: "12",
  costBasis: "120",
  averagePrice: "10",
  price: null,
  priceDate: null,
  priceSource: null,
  priceFetchedAt: null,
  priceProvider: null,
  value: null,
  gain: null,
  gainRatio: null,
});

/** Opens "Corporate Action → ISIN-Wechsel" of Altname Software SE from the Positions table's row menu. */
async function openFromTable() {
  const user = userEvent.setup({ delay: null });
  render(
    <PositionsTable
      positions={[position(oldName), position(other)]}
      cashBalance="0"
      isinChanges={isinChanges}
      securities={[oldName, newName, other]}
    />,
  );
  await user.click(screen.getAllByRole("button", { name: "Aktionen für Altname Software SE" })[0]);
  await user.click(await screen.findByRole("menuitem", { name: "Corporate Action → ISIN-Wechsel" }));
  const dialog = await screen.findByRole("dialog", { name: "ISIN-Wechsel – Altname Software SE" });
  return { user, dialog };
}

describe("IsinChangeDialog from the Positions row menu", () => {
  it("opens for the row's Security and lists only its ISIN changes", async () => {
    const { dialog } = await openFromTable();
    const list = within(dialog).getByRole("list", { name: "Erfasste ISIN-Wechsel" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Altname Software SE → Neuname Software SE");
  });

  it("records a change to the selected Security, offering every other Security", async () => {
    save.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof saveIsinChangeAction>>);
    const { user, dialog } = await openFromTable();
    const form = within(dialog).getByRole("form", { name: "ISIN-Wechsel erfassen" });
    await user.click(within(form).getByRole("combobox", { name: "Neue Security" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Neuname Software SE (DE000SYN0013)", "Synthetik Gamma AG (DE000SYN0003)", "Neue Security anlegen"]);
    await user.click(screen.getByRole("option", { name: "Neuname Software SE (DE000SYN0013)" }));
    fireEvent.change(form.querySelector('input[name="date"]')!, { target: { value: "2024-07-01" } });
    await user.type(within(form).getByRole("textbox", { name: "Alte Stückzahl" }), "12");
    await user.type(within(form).getByRole("textbox", { name: "Neue Stückzahl" }), "6");
    await user.click(within(form).getByRole("button", { name: "ISIN-Wechsel erfassen" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toEqual({
      oldSecurityId: "s1",
      newSecurityId: "s2",
      date: "2024-07-01",
      oldQuantity: "12",
      newQuantity: "6",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a field error under the matching field and keeps the input", async () => {
    save.mockResolvedValue({ ok: false, reason: "new-quantity-invalid" });
    const { user, dialog } = await openFromTable();
    const form = within(dialog).getByRole("form", { name: "ISIN-Wechsel erfassen" });
    const newQuantity = within(form).getByRole("textbox", { name: "Neue Stückzahl" }) as HTMLInputElement;
    await user.type(newQuantity, "0");
    await user.click(within(form).getByRole("button", { name: "ISIN-Wechsel erfassen" }));

    const message = "Bitte eine neue Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.";
    expect(await within(form).findByText(message)).toBeTruthy();
    expect(newQuantity.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(newQuantity.getAttribute("aria-describedby")!)?.textContent).toBe(message);
    expect(newQuantity.value).toBe("0");
    expect(within(form).queryByRole("alert")).toBeNull();
  });

  it("edits a listed change: prefills date and quantities and sends its isinChangeId", async () => {
    save.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof saveIsinChangeAction>>);
    const { user, dialog } = await openFromTable();
    await user.click(
      within(dialog).getByRole("button", { name: "ISIN-Wechsel vom 02.05.2024 (Altname Software SE → Neuname Software SE) bearbeiten" }),
    );
    const form = within(dialog).getByRole("form", { name: "ISIN-Wechsel bearbeiten" });
    expect((within(form).getByRole("textbox", { name: "Alte Stückzahl" }) as HTMLInputElement).value).toBe("12");
    await user.click(within(form).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toEqual({
      oldSecurityId: "s1",
      isinChangeId: "ic1",
      date: "2024-05-02",
      oldQuantity: "12",
      newQuantity: "6",
    });
    expect(await within(dialog).findByRole("form", { name: "ISIN-Wechsel erfassen" })).toBeTruthy();
  });

  it("deletes a listed change after the inline confirmation", async () => {
    remove.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof deleteIsinChangeAction>>);
    const { user, dialog } = await openFromTable();
    const label = "ISIN-Wechsel vom 02.05.2024 (Altname Software SE → Neuname Software SE)";
    await user.click(within(dialog).getByRole("button", { name: `${label} löschen` }));
    const item = within(dialog).getByText(`${label} löschen?`).closest("li")!;
    await user.click(within(item).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("ic1"));
  });
});
