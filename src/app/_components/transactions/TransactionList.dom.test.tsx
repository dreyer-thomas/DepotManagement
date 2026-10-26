// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { SecuritySummary, TransactionRecord } from "@/modules/ledger";
import { TransactionList } from "./TransactionList";

vi.mock("@/app/_actions/transactions", () => ({
  saveTransactionAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
}));

registerDomCleanup();

const security: SecuritySummary = { id: "s1", name: "Welt ETF", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF" };
const buy: TransactionRecord = {
  id: "t1",
  depotId: "d1",
  type: "BUY",
  date: "2026-10-01",
  sequence: 1,
  quantity: "10",
  price: "100",
  amount: "1000",
  fee: "0",
  tax: "0",
  note: null,
  security,
};

describe("TransactionList Security link", () => {
  it("links the Security to its page with the Depot selected; the click does not open the edit dialog", () => {
    render(<TransactionList transactions={[buy]} depot={{ id: "d1", name: "Hauptdepot" }} securities={[security]} today="2026-10-26" />);
    const link = screen.getByRole("link", { name: "Welt ETF" });
    expect(link.getAttribute("href")).toBe("/securities/s1?depot=d1");
    // Keep the test page from navigating; the row must not see the click either way.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
    // A click elsewhere in the row still opens the edit dialog.
    fireEvent.click(screen.getByText("01.10.2026"));
    expect(screen.getByRole("dialog", { name: "Buchung bearbeiten" })).toBeTruthy();
  });
});

describe("TransactionList holding corrections and notes", () => {
  it("shows a Bestandskorrektur with its signed quantity and a note as caption", () => {
    const correction: TransactionRecord = { ...buy, id: "t2", type: "ADJUSTMENT", quantity: "-2", price: null, amount: "0" };
    const deposit: TransactionRecord = {
      ...buy,
      id: "t3",
      type: "DEPOSIT",
      quantity: null,
      price: null,
      amount: "12.34",
      note: "Kontoabgleich",
      security: null,
    };
    render(
      <TransactionList transactions={[correction, deposit]} depot={{ id: "d1", name: "Hauptdepot" }} securities={[security]} today="2026-10-26" />,
    );
    expect(screen.getByText("Bestandskorrektur")).toBeTruthy();
    expect(screen.getByText("-2 Stück")).toBeTruthy();
    expect(screen.getByText("Kontoabgleich")).toBeTruthy();
  });
});
