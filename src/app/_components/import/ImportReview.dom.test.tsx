// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { ImportBatchView, ImportItemView, ProposalReviewView } from "@/modules/import";
import { ImportReview } from "./ImportReview";

const actions = vi.hoisted(() => ({
  bookImportBatchAction: vi.fn(),
  decideProposalAction: vi.fn(),
  updateProposalAction: vi.fn(),
  discardImportBatchAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/app/_actions/import", () => actions);
vi.mock("@/app/_actions/transactions", () => ({ saveTransactionAction: vi.fn(), deleteTransactionAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), unstable_rethrow: vi.fn() }));

registerDomCleanup();

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  refresh.mockReset();
});

const BUY = { type: "BUY", date: "2026-10-15", isin: "IE00BK5BQT80", name: "Beispiel ETF", quantity: "3.412871", price: "43.95", amount: "150", fee: "0", tax: "0" } as const;

function proposal(itemId: string, overrides: Partial<ProposalReviewView> = {}): ProposalReviewView {
  return {
    key: `${itemId}:0`,
    index: 0,
    proposal: { ...BUY },
    status: "unique",
    ledgerMatches: [],
    siblingMatch: false,
    decision: null,
    effective: "book",
    securityId: null,
    securityName: "Beispiel ETF",
    ...overrides,
  };
}

function item(id: string, overrides: Partial<ImportItemView> = {}): ImportItemView {
  return {
    id,
    position: 0,
    fileName: `${id}.pdf`,
    status: "PARSED",
    reviewStatus: "PARSED",
    documentType: "trade",
    reason: null,
    duplicateUpload: false,
    documentDate: null,
    proposals: [proposal(id)],
    ...overrides,
  };
}

function batch(overrides: Partial<ImportBatchView> = {}): ImportBatchView {
  return {
    id: "b1",
    depotId: "d1",
    depotName: "ROBIN",
    broker: "DEUTSCHE_BANK",
    depotArchived: false,
    status: "OPEN",
    createdAt: "2026-10-26T10:00:00.000Z",
    items: [item("a")],
    files: { PARSED: 1, AMBIGUOUS: 0, DUPLICATE: 0, FAILED: 0 },
    openDecisions: 0,
    bookKeys: ["a:0"],
    ...overrides,
  };
}

const ambiguousBatch = () =>
  batch({
    items: [
      item("a", {
        reviewStatus: "AMBIGUOUS",
        proposals: [proposal("a", { status: "ambiguous", siblingMatch: true, effective: "open" })],
      }),
      item("b", {
        reviewStatus: "AMBIGUOUS",
        proposals: [proposal("b", { status: "ambiguous", siblingMatch: true, effective: "open" })],
      }),
    ],
    files: { PARSED: 0, AMBIGUOUS: 2, DUPLICATE: 0, FAILED: 0 },
    openDecisions: 2,
    bookKeys: [],
  });

const show = (view: ImportBatchView) => render(<ImportReview batch={view} securities={[]} today="2026-10-26" />);

describe("ImportReview", () => {
  it("shows the summary, chips and notes and disables booking while a decision is open", () => {
    show(ambiguousBatch());
    expect(screen.getByText(/2 Dateien: 0 erkannt, 2 mehrdeutig/).textContent).toBe("2 Dateien: 0 erkannt, 2 mehrdeutig · 2 Entscheidungen offen");
    expect(screen.getAllByText("mehrdeutig")).toHaveLength(2);
    expect(screen.getAllByText("Gleiche Buchung mehrfach in diesem Import.")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "0 Buchungen buchen" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables booking once every decision is made", () => {
    const decided = ambiguousBatch();
    for (const entry of decided.items) entry.proposals[0] = { ...entry.proposals[0]!, decision: "book", effective: "book" };
    show({ ...decided, openDecisions: 0, bookKeys: ["a:0", "b:0"] });
    expect((screen.getByRole("button", { name: "2 Buchungen buchen" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stores a decision through the action and refreshes", async () => {
    actions.decideProposalAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    show(ambiguousBatch());
    const card = screen.getByRole("region", { name: "a.pdf" });
    await user.click(within(card).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(actions.decideProposalAction).toHaveBeenCalledWith("b1", "a", 0, "book"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("toggles a unique row to Verwerfen", async () => {
    actions.decideProposalAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    show(batch());
    const card = screen.getByRole("region", { name: "a.pdf" });
    expect(within(card).getByRole("button", { name: "Buchen" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(card).getByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(actions.decideProposalAction).toHaveBeenCalledWith("b1", "a", 0, "discard"));
  });

  it("shows a duplicate without a decision control and the existing booking's date", () => {
    const match = { id: "t1", depotId: "d1", type: "BUY", date: "2026-09-30", sequence: 0, quantity: "3.412871", price: "43.95", amount: "150", fee: "0", tax: "0", security: null } as const;
    show(
      batch({
        items: [item("a", { reviewStatus: "DUPLICATE", proposals: [proposal("a", { status: "duplicate", effective: "discard", ledgerMatches: [match] })] })],
        files: { PARSED: 0, AMBIGUOUS: 0, DUPLICATE: 1, FAILED: 0 },
        bookKeys: [],
      }),
    );
    expect(screen.getByText("Duplikat")).toBeTruthy();
    expect(screen.getByText("Bereits gebucht am 30.09.2026. Wird nicht erneut gebucht.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Buchen" })).toBeNull();
    expect((screen.getByRole("button", { name: "0 Buchungen buchen" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names each ledger match of an ambiguous proposal", () => {
    const match = { id: "t1", depotId: "d1", type: "BUY", date: "2026-10-15", sequence: 0, quantity: "3.412871", price: "43.95", amount: "150", fee: "0", tax: "0", security: null } as const;
    show(
      batch({
        items: [item("a", { reviewStatus: "AMBIGUOUS", proposals: [proposal("a", { status: "ambiguous", effective: "open", ledgerMatches: [match, { ...match, id: "t2" }] })] })],
        openDecisions: 1,
        bookKeys: [],
      }),
    );
    expect(screen.getAllByText("Gleiche Buchung bereits vorhanden: Kauf 15.10.2026, 3,412871 Stück, 150,00 €.")).toHaveLength(2);
    expect(screen.getByText("Bitte entscheiden.")).toBeTruthy();
  });

  it("edits a row inline and shows a German field error", async () => {
    actions.updateProposalAction.mockResolvedValue({ ok: false, reason: "invalid", field: "quantity", issue: "quantity-invalid" });
    const user = userEvent.setup({ delay: null });
    show(batch());
    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const form = screen.getByRole("form", { name: "Kauf bearbeiten" });
    const quantity = within(form).getByRole("textbox", { name: "Stück" }) as HTMLInputElement;
    expect(quantity.value).toBe("3,412871");
    await user.clear(quantity);
    await user.type(quantity, "0");
    await user.click(within(form).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(actions.updateProposalAction).toHaveBeenCalledTimes(1));
    expect(actions.updateProposalAction.mock.calls[0]).toEqual([
      "b1",
      "a",
      0,
      { date: "2026-10-15", quantity: "0", price: "43,95", amount: "150", fee: "0", tax: "0" },
    ]);
    expect(await within(form).findByText("Bitte eine Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables booking while an edit row is open", async () => {
    const user = userEvent.setup({ delay: null });
    show(batch());
    const book = () => screen.getByRole("button", { name: "1 Buchung buchen" }) as HTMLButtonElement;
    expect(book().disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(book().disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(book().disabled).toBe(false);
  });

  it("disables the row controls while booking is pending", async () => {
    let resolve: (value: unknown) => void = () => {};
    actions.bookImportBatchAction.mockReturnValue(new Promise((done) => (resolve = done)));
    const user = userEvent.setup({ delay: null });
    show(batch());
    await user.click(screen.getByRole("button", { name: "1 Buchung buchen" }));
    const card = screen.getByRole("region", { name: "a.pdf" });
    await waitFor(() => expect((within(card).getByRole("button", { name: "Buchen" }) as HTMLButtonElement).disabled).toBe(true));
    expect((within(card).getByRole("button", { name: "Bearbeiten" }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ ok: false, reason: "not-found" });
    await screen.findByRole("alert");
  });

  it("refreshes when a decision finds the batch gone", async () => {
    actions.decideProposalAction.mockResolvedValue({ ok: false, reason: "not-found" });
    const user = userEvent.setup({ delay: null });
    show(batch());
    await user.click(within(screen.getByRole("region", { name: "a.pdf" })).getByRole("button", { name: "Verwerfen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Import nicht gefunden oder bereits gebucht.");
    expect(refresh).toHaveBeenCalled();
  });

  it("closes the edit row and refreshes after a saved edit", async () => {
    actions.updateProposalAction.mockResolvedValue({ ok: true, proposal: BUY });
    const user = userEvent.setup({ delay: null });
    show(batch());
    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("form", { name: "Kauf bearbeiten" })).toBeNull();
  });

  it("books with the shown keys and shows the snackbar", async () => {
    actions.bookImportBatchAction.mockResolvedValue({ ok: true, booked: 1, depotId: "d1" });
    const user = userEvent.setup({ delay: null });
    show(batch());
    await user.click(screen.getByRole("button", { name: "1 Buchung buchen" }));
    expect(actions.bookImportBatchAction).toHaveBeenCalledWith("b1", '["a:0"]');
    expect((await screen.findByRole("status")).textContent).toBe("1 Buchung gebucht.");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a ledger rejection with the file name and a changed review with a refresh", async () => {
    actions.bookImportBatchAction.mockResolvedValueOnce({
      ok: false,
      reason: "ledger-rejected",
      fileName: "a.pdf",
      type: "SELL",
      failure: { ok: false, reason: "sell-exceeds-holding", available: "2" },
    });
    const user = userEvent.setup({ delay: null });
    show(batch());
    await user.click(screen.getByRole("button", { name: "1 Buchung buchen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a.pdf: Verkauf übersteigt Bestand (2 Stück). Es wurde nichts gebucht.");
    expect(refresh).not.toHaveBeenCalled();
    actions.bookImportBatchAction.mockResolvedValueOnce({ ok: false, reason: "review-changed" });
    await user.click(screen.getByRole("button", { name: "1 Buchung buchen" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Der Import hat sich geändert. Bitte erneut prüfen."));
    expect(refresh).toHaveBeenCalledTimes(1);
    // A decision opened on the server meanwhile (e.g. a new ledger row): the page reloads to show it.
    actions.bookImportBatchAction.mockResolvedValueOnce({ ok: false, reason: "decisions-open" });
    await user.click(screen.getByRole("button", { name: "1 Buchung buchen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("opens Manuell erfassen for a failed file with its readable date", async () => {
    const user = userEvent.setup({ delay: null });
    show(
      batch({
        items: [item("x", { status: "FAILED", reviewStatus: "FAILED", reason: "Layout nicht erkannt.", documentDate: "2026-10-15", proposals: [] })],
        files: { PARSED: 0, AMBIGUOUS: 0, DUPLICATE: 0, FAILED: 1 },
        bookKeys: [],
      }),
    );
    expect(screen.getByText("fehlgeschlagen")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Manuell erfassen" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((dialog.querySelector('input[name="date"]') as HTMLInputElement).value).toBe("2026-10-15");
    expect((dialog.querySelector('input[name="depotId"]') as HTMLInputElement).value).toBe("d1");
  });

  it("prefills today without a readable date and hides Manuell erfassen for an archived Depot", async () => {
    const user = userEvent.setup({ delay: null });
    const failed = item("x", { status: "FAILED", reviewStatus: "FAILED", reason: "Layout nicht erkannt.", proposals: [] });
    const { unmount } = show(batch({ items: [failed], bookKeys: [] }));
    await user.click(screen.getByRole("button", { name: "Manuell erfassen" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((dialog.querySelector('input[name="date"]') as HTMLInputElement).value).toBe("2026-10-26");
    unmount();
    show(batch({ items: [failed, item("a")], depotArchived: true }));
    expect(screen.queryByRole("button", { name: "Manuell erfassen" })).toBeNull();
    expect((screen.getByRole("button", { name: "1 Buchung buchen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Depot ist archiviert. Bitte zuerst reaktivieren, um zu buchen.")).toBeTruthy();
  });

  it("shows a BOOKED batch read-only", () => {
    show(batch({ status: "BOOKED" }));
    expect(screen.getByText(/Dieser Import wurde gebucht\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zum Depot" }).getAttribute("href")).toBe("/depots/d1");
    expect(screen.queryByRole("button", { name: /Buchung/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verwerfen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
  });
});
