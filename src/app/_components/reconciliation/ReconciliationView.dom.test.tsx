// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import {
  bookReconciliationCorrectionAction,
  finishReconciliationAction,
  saveReconciliationRowAction,
} from "@/app/_actions/reconciliation";
import type { ReconciliationRowRecord, ReconciliationRunView } from "@/modules/ledger";
import { ReconciliationRun } from "./ReconciliationView";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/app/_actions/reconciliation", () => ({
  openReconciliationAction: vi.fn(),
  saveReconciliationRowAction: vi.fn(),
  bookReconciliationCorrectionAction: vi.fn(),
  finishReconciliationAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveReconciliationRowAction);
const book = vi.mocked(bookReconciliationCorrectionAction);
const finish = vi.mocked(finishReconciliationAction);

beforeEach(() => {
  save.mockReset();
  book.mockReset();
  finish.mockReset();
  push.mockReset();
});

const alpha = { id: "s1", name: "Synthetic Alpha AG", isin: "DE000SYNCA09", cryptoSymbol: null, assetType: "STOCK" as const };
const beta = { id: "s2", name: "Synthetic Beta AG", isin: "DE000SYNCB08", cryptoSymbol: null, assetType: "STOCK" as const };

function row(overrides: Partial<ReconciliationRowRecord>): ReconciliationRowRecord {
  return {
    securityId: "s1",
    security: alpha,
    appValue: "10",
    statementValue: null,
    checked: false,
    status: "open",
    difference: null,
    averagePrice: "100",
    defaultUnitCost: "100",
    ...overrides,
  };
}

const run: ReconciliationRunView = {
  id: "r1",
  depotId: "d1",
  statementDate: "2026-10-20",
  rows: [
    row({ statementValue: "12", status: "difference", difference: "2" }),
    row({ securityId: "s2", security: beta, appValue: "5", checked: true, status: "reconciled", averagePrice: "0", defaultUnitCost: "0" }),
    row({ securityId: null, security: null, appValue: "100", statementValue: "112.34", status: "difference", difference: "12.34", averagePrice: null, defaultUnitCost: null }),
  ],
  progress: { reconciled: 1, total: 3 },
};

describe("ReconciliationRun", () => {
  it("shows Stichtag, progress, app values, entries and status as text", () => {
    render(<ReconciliationRun run={run} readOnly={false} />);
    expect(screen.getByText("Stichtag 20.10.2026")).toBeTruthy();
    expect(screen.getByText("1 von 3 abgeglichen")).toBeTruthy();
    expect(screen.getByText("Differenz +2 Stück")).toBeTruthy();
    expect(screen.getByText("abgeglichen")).toBeTruthy();
    expect(screen.getByText(/^Differenz \+12,34\s€$/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Laut Auszug: Synthetic Alpha AG" }) as HTMLInputElement).value).toBe("12");
    expect((screen.getByRole("checkbox", { name: "stimmt: Synthetic Beta AG" }) as HTMLInputElement).checked).toBe(true);
    const link = screen.getByRole("link", { name: "Buchungen ansehen" });
    expect(link.getAttribute("href")).toBe("/securities/s1?depot=d1#security-transactions");
    // The Cash row has no Security history link, but a correction.
    expect(screen.getAllByRole("link", { name: "Buchungen ansehen" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Korrektur buchen" })).toHaveLength(2);
  });

  it("saves a statement value on Enter and the check on change", async () => {
    save.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    render(<ReconciliationRun run={run} readOnly={false} />);
    const input = screen.getByRole("textbox", { name: "Laut Auszug: Cash-Konto" });
    await user.clear(input);
    await user.type(input, "112,30{Enter}");
    await waitFor(() => expect(save).toHaveBeenCalledWith("r1", null, { statementValue: "112,30" }));
    await user.click(screen.getByRole("checkbox", { name: "stimmt: Synthetic Alpha AG" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("r1", "s1", { checked: true }));
  });

  it("shows a save failure at the input", async () => {
    save.mockResolvedValue({ ok: false, reason: "value-invalid" });
    const user = userEvent.setup({ delay: null });
    render(<ReconciliationRun run={run} readOnly={false} />);
    const input = screen.getByRole("textbox", { name: "Laut Auszug: Synthetic Alpha AG" });
    await user.clear(input);
    await user.type(input, "-1");
    await user.tab();
    expect(await screen.findByText(/Bitte einen gültigen Wert eingeben/)).toBeTruthy();
  });

  it("books a Position correction with the prefilled, editable unit cost", async () => {
    book.mockResolvedValue({ ok: false, reason: "price-invalid" });
    const user = userEvent.setup({ delay: null });
    render(<ReconciliationRun run={run} readOnly={false} />);
    await user.click(screen.getAllByRole("button", { name: "Korrektur buchen" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Korrektur buchen" });
    expect(within(dialog).getByText("Bestandskorrektur +2 Stück")).toBeTruthy();
    const cost = within(dialog).getByRole("textbox", { name: "Einstandskurs je Stück" }) as HTMLInputElement;
    expect(cost.value).toBe("100");
    await user.clear(cost);
    await user.type(cost, "95,5");
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(book).toHaveBeenCalledWith("r1", "s1", "95,5"));
    expect(await within(dialog).findByText("Bitte einen Einstandskurs von mindestens 0 eingeben.")).toBeTruthy();
  });

  it("books a cash correction as Einzahlung with the note Kontoabgleich and closes", async () => {
    book.mockResolvedValue({ ok: true, transaction: {} as never });
    const user = userEvent.setup({ delay: null });
    render(<ReconciliationRun run={run} readOnly={false} />);
    await user.click(screen.getAllByRole("button", { name: "Korrektur buchen" })[1]);
    const dialog = await screen.findByRole("dialog", { name: "Korrektur buchen" });
    expect(within(dialog).getByText(/^Einzahlung 12,34\s€$/)).toBeTruthy();
    expect(within(dialog).getByText("Notiz: Kontoabgleich")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(book).toHaveBeenCalledWith("r1", null, undefined));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks once before finishing with open rows, then returns to the Depot", async () => {
    finish.mockResolvedValue({ ok: true, statementDate: "2026-10-20" });
    const user = userEvent.setup({ delay: null });
    render(<ReconciliationRun run={run} readOnly={false} />);
    await user.click(screen.getByRole("button", { name: "Abgleich abschließen" }));
    const dialog = await screen.findByRole("dialog", { name: "Abgleich abschließen?" });
    expect(within(dialog).getByText("Noch 2 Zeilen offen. Trotzdem abschließen?")).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Trotzdem abschließen" }));
    await waitFor(() => expect(finish).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/depots/d1"));
  });

  it("finishes without asking when every row is reconciled", async () => {
    finish.mockResolvedValue({ ok: true, statementDate: "2026-10-20" });
    const user = userEvent.setup({ delay: null });
    const done = { ...run, rows: [run.rows[1]], progress: { reconciled: 1, total: 1 } };
    render(<ReconciliationRun run={done} readOnly={false} />);
    await user.click(screen.getByRole("button", { name: "Abgleich abschließen" }));
    await waitFor(() => expect(finish).toHaveBeenCalledWith("r1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is read-only for an archived Depot", () => {
    render(<ReconciliationRun run={run} readOnly />);
    expect(screen.queryByRole("button", { name: "Korrektur buchen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abgleich abschließen" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Laut Auszug: Cash-Konto" }) as HTMLInputElement).disabled).toBe(true);
  });
});
