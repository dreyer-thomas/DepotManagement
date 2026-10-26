// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { SecuritySummary } from "@/modules/ledger";
import { NewTransactionFab } from "./NewTransactionFab";

vi.mock("@/app/_actions/transactions", () => ({
  saveTransactionAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
}));

registerDomCleanup();

// Phone width: the FAB is hidden from `md`.
beforeEach(() => {
  (window as unknown as { happyDOM: { setViewport: (size: { width: number; height: number }) => void } }).happyDOM.setViewport({
    width: 375,
    height: 800,
  });
});

const securities: SecuritySummary[] = [{ id: "s1", name: "Welt ETF", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF" }];

/** The Depot id the dialog's form books into. */
const depotOf = (dialog: HTMLElement) => (dialog.querySelector('input[name="depotId"]') as HTMLInputElement | null)?.value;

describe("NewTransactionFab", () => {
  it("opens 'Neue Buchung' directly for the only Depot", async () => {
    const user = userEvent.setup({ delay: null });
    render(<NewTransactionFab depots={[{ id: "d1", name: "Hauptdepot" }]} securities={securities} today="2026-10-26" />);
    await user.click(screen.getByRole("button", { name: "Neue Buchung" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect(depotOf(dialog)).toBe("d1");
  });

  it("asks 'Depot wählen' first with several Depots, then opens the dialog for the chosen one", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <NewTransactionFab
        depots={[
          { id: "d1", name: "Hauptdepot" },
          { id: "d2", name: "Zweitdepot" },
        ]}
        securities={securities}
        today="2026-10-26"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Neue Buchung" }));
    const menu = await screen.findByRole("menu", { name: "Depot wählen" });
    expect(screen.queryByRole("dialog", { name: "Neue Buchung" })).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: "Zweitdepot" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect(depotOf(dialog)).toBe("d2");
  });

  it("renders nothing without a Depot", () => {
    const { container } = render(<NewTransactionFab depots={[]} securities={securities} today="2026-10-26" />);
    expect(container.innerHTML).toBe("");
  });
});
