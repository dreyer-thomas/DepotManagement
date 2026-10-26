// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { saveTransactionAction } from "@/app/_actions/transactions";
import type { SecuritySummary } from "@/modules/ledger";
import { DepotSwitcher } from "./DepotSwitcher";
import { PriceLine } from "./PriceLine";
import { SecurityActions } from "./SecurityActions";

vi.mock("@/app/_actions/transactions", () => ({
  saveTransactionAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
}));
vi.mock("@/app/_actions/corporate-actions", () => ({
  saveSplitAction: vi.fn(),
  deleteSplitAction: vi.fn(),
  saveIsinChangeAction: vi.fn(),
  deleteIsinChangeAction: vi.fn(),
}));
vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

registerDomCleanup();

const save = vi.mocked(saveTransactionAction);
beforeEach(() => save.mockReset());

const security: SecuritySummary = { id: "s1", name: "Welt ETF", isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF" };

describe("DepotSwitcher", () => {
  it("links Alle Depots and each Depot, marking the selected one", () => {
    render(
      <DepotSwitcher
        securityId="s1"
        depots={[
          { id: "a", name: "Alpha", archived: false },
          { id: "b", name: "Beta", archived: true },
        ]}
        selected="b"
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Depot" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Alle Depots", "/securities/s1", null],
      ["Alpha", "/securities/s1?depot=a", null],
      ["Beta (archiviert)", "/securities/s1?depot=b", "page"],
    ]);
  });

  it("omits Alle Depots when every booking Depot is archived", () => {
    render(<DepotSwitcher securityId="s1" depots={[{ id: "b", name: "Beta", archived: true }]} selected="b" />);
    expect(screen.queryByRole("link", { name: "Alle Depots" })).toBeNull();
  });
});

describe("SecurityActions", () => {
  const props = { security, splits: [], isinChanges: [], securities: [security], today: "2026-10-26" };

  it("opens Neue Buchung with the Depot and the Security preselected", async () => {
    save.mockResolvedValue({ ok: false, reason: "quantity-invalid" });
    const user = userEvent.setup({ delay: null });
    render(<SecurityActions {...props} transactionDepots={[{ id: "a", name: "Alpha" }]} />);
    await user.click(screen.getByRole("button", { name: "Aktionen für Welt ETF" }));
    await user.click(await screen.findByRole("menuitem", { name: "Neue Buchung" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((within(dialog).getByRole("combobox", { name: "Security" }) as HTMLInputElement).value).toBe("Welt ETF (IE00B4L5Y983)");
    await user.click(within(dialog).getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(formEntries(save.mock.calls[0][1])).toMatchObject({ depotId: "a", securityId: "s1" });
  }, 20_000);

  it("asks for the Depot first with several Depots", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <SecurityActions
        {...props}
        transactionDepots={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Aktionen für Welt ETF" }));
    await user.click(await screen.findByRole("menuitem", { name: "Neue Buchung" }));
    const menu = await screen.findByRole("menu", { name: "Depot wählen" });
    await user.click(within(menu).getByRole("menuitem", { name: "Beta" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Buchung" });
    expect((dialog.querySelector('input[name="depotId"]') as HTMLInputElement).value).toBe("b");
  }, 20_000);

  it("offers split and ISIN change, and no Neue Buchung without a Depot", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SecurityActions {...props} transactionDepots={[]} />);
    await user.click(screen.getByRole("button", { name: "Aktionen für Welt ETF" }));
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["Split …", "ISIN-Wechsel …"]);
    await user.click(screen.getByRole("menuitem", { name: "Split …" }));
    expect(await screen.findByRole("dialog", { name: "Split – Welt ETF" })).toBeTruthy();
  }, 20_000);
});

describe("PriceLine", () => {
  const price = { price: "100", date: "2026-10-20", source: "provider" as const, fetchedAt: "2026-10-20T18:00:00.000Z", provider: "YAHOO" };

  it("shows a stale price with the hint and the manual price button for a held Security", () => {
    render(<PriceLine price={price} security={security} held today="2026-10-26" />);
    expect(screen.getByText("Kurs vom 20.10.2026 – veraltet")).toBeTruthy();
    expect(screen.getByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kurs manuell eintragen – Welt ETF" })).toBeTruthy();
  });

  it("shows no hint for a sold Security or a current price", () => {
    const { unmount } = render(<PriceLine price={price} security={security} held={false} today="2026-10-26" />);
    expect(screen.queryByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeNull();
    unmount();
    render(<PriceLine price={{ ...price, date: "2026-10-25" }} security={security} held today="2026-10-26" />);
    expect(screen.getByText("Kurs vom 25.10.2026")).toBeTruthy();
    expect(screen.queryByText("Keine Kursquelle liefert aktuelle Kurse.")).toBeNull();
  });

  it("says when there is no price", () => {
    render(<PriceLine price={null} security={security} held today="2026-10-26" />);
    expect(screen.getByText("Kein Kurs vorhanden.")).toBeTruthy();
  });
});
