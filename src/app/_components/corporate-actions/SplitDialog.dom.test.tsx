// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { deleteSplitAction, saveSplitAction } from "@/app/_actions/corporate-actions";
import { PositionsTable } from "@/app/_components/positions/PositionsTable";
import type { PositionRecord, SecuritySummary, SplitRecord } from "@/modules/ledger";
import { SplitDialog } from "./SplitDialog";

vi.mock("@/app/_actions/corporate-actions", () => ({
  saveSplitAction: vi.fn(),
  deleteSplitAction: vi.fn(),
  saveIsinChangeAction: vi.fn(),
  deleteIsinChangeAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveSplitAction);
const remove = vi.mocked(deleteSplitAction);

beforeEach(() => {
  save.mockReset();
  remove.mockReset();
});

const alpha: SecuritySummary = { id: "s1", name: "Synthetik Alpha AG", isin: "DE000SYN0001", cryptoSymbol: null, assetType: "STOCK" };
const beta: SecuritySummary = { id: "s2", name: "Synthetik Beta AG", isin: "DE000SYN0002", cryptoSymbol: null, assetType: "STOCK" };

const splits: SplitRecord[] = [
  { id: "sp1", security: alpha, date: "2024-03-01", ratioOld: "1", ratioNew: "4" },
  { id: "sp2", security: beta, date: "2024-04-01", ratioOld: "1", ratioNew: "10" },
  { id: "sp3", security: alpha, date: "2024-06-03", ratioOld: "2", ratioNew: "1" },
];

const position = (security: SecuritySummary): PositionRecord => ({
  security,
  quantity: "10",
  costBasis: "100",
  averagePrice: "10",
  price: "12",
  priceDate: "2024-06-03",
  priceSource: "transaction",
  priceFetchedAt: null,
  priceProvider: null,
  value: "120",
  gain: "20",
  gainRatio: "0.2",
});

const saved = { ok: true } as Awaited<ReturnType<typeof saveSplitAction>>;

/** Opens "Corporate Action → Split" of Synthetik Alpha AG from the Positions table. */
async function openFromTable() {
  const user = userEvent.setup({ delay: null });
  render(<PositionsTable positions={[position(alpha), position(beta)]} cashBalance="0" splits={splits} securities={[alpha, beta]} />);
  await user.click(screen.getAllByRole("button", { name: "Aktionen für Synthetik Alpha AG" })[0]);
  await user.click(await screen.findByRole("menuitem", { name: "Corporate Action → Split" }));
  const dialog = await screen.findByRole("dialog", { name: "Split – Synthetik Alpha AG" });
  return { user, dialog };
}

describe("SplitDialog", () => {
  it("lists only the opened Security's splits", async () => {
    const { dialog } = await openFromTable();
    const list = within(dialog).getByRole("list", { name: "Erfasste Splits" });
    const rows = within(list).getAllByRole("listitem").map((item) => item.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("01.03.2024 · 1:4");
    expect(rows[1]).toContain("03.06.2024 · 2:1");
    expect(within(dialog).queryByText(/1:10/)).toBeNull();
  });

  it("says so when the Security has no split", () => {
    render(<SplitDialog open onClose={() => {}} security={alpha} splits={splits.filter((s) => s.security.id === beta.id)} />);
    expect(screen.getByText("Noch keine Splits erfasst.")).toBeTruthy();
  });

  it("records a new split of the Security", async () => {
    save.mockResolvedValue(saved);
    const { user, dialog } = await openFromTable();
    const form = within(dialog).getByRole("form", { name: "Split erfassen" });
    await user.type(within(form).getByRole("textbox", { name: "Alt" }), "1");
    await user.type(within(form).getByRole("textbox", { name: "Neu" }), "3");
    await user.click(within(form).getByRole("button", { name: "Split erfassen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toEqual({ securityId: "s1", ratio: "1:3", date: "" });
  });

  it("edits a split: prefills the form, sends its splitId, and resets the form after saving", async () => {
    save.mockResolvedValue(saved);
    const { user, dialog } = await openFromTable();
    await user.click(within(dialog).getByRole("button", { name: "Split vom 01.03.2024 (1:4) bearbeiten" }));

    const form = within(dialog).getByRole("form", { name: "Split bearbeiten" });
    const ratioOld = within(form).getByRole("textbox", { name: "Alt" }) as HTMLInputElement;
    const ratioNew = within(form).getByRole("textbox", { name: "Neu" }) as HTMLInputElement;
    expect([ratioOld.value, ratioNew.value]).toEqual(["1", "4"]);
    expect((form.querySelector('input[name="date"]') as HTMLInputElement).value).toBe("2024-03-01");
    await user.clear(ratioNew);
    await user.type(ratioNew, "5");
    await user.click(within(form).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toEqual({ securityId: "s1", splitId: "sp1", ratio: "1:5", date: "2024-03-01" });
    const fresh = await within(dialog).findByRole("form", { name: "Split erfassen" });
    expect((within(fresh).getByRole("textbox", { name: "Alt" }) as HTMLInputElement).value).toBe("");
    expect((within(fresh).getByRole("textbox", { name: "Neu" }) as HTMLInputElement).value).toBe("");
    expect(dialog.isConnected).toBe(true);
  });

  it("deletes a split after the inline confirmation", async () => {
    remove.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof deleteSplitAction>>);
    const { user, dialog } = await openFromTable();
    await user.click(within(dialog).getByRole("button", { name: "Split vom 03.06.2024 (2:1) löschen" }));
    expect(within(dialog).getByText("Split vom 03.06.2024 (2:1) löschen?")).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    const item = within(dialog).getByText("Split vom 03.06.2024 (2:1) löschen?").closest("li")!;
    await user.click(within(item).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("sp3"));
  });

  it("shows a delete failure in an Alert", async () => {
    remove.mockResolvedValue({ ok: false, reason: "later-sell-exceeds-holding", date: "2024-07-01" } as Awaited<
      ReturnType<typeof deleteSplitAction>
    >);
    const { user, dialog } = await openFromTable();
    await user.click(within(dialog).getByRole("button", { name: "Split vom 01.03.2024 (1:4) löschen" }));
    const item = within(dialog).getByText("Split vom 01.03.2024 (1:4) löschen?").closest("li")!;
    await user.click(within(item).getByRole("button", { name: "Löschen" }));
    expect((await within(item).findByRole("alert")).textContent).toBe(
      "Nicht möglich: Der Verkauf am 01.07.2024 würde den Bestand übersteigen.",
    );
  });
});
