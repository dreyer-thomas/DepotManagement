// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { setPriceMarksAction } from "@/app/_actions/price-marks";
import type { PriceMarksEditInfo } from "./PriceMarkFields";
import { PriceMarksDialog } from "./PriceMarksDialog";

vi.mock("@/app/_actions/price-marks", () => ({ setPriceMarksAction: vi.fn() }));

registerDomCleanup();

const SLOW = 15_000;
const TODAY = "2026-11-11";
const set = vi.mocked(setPriceMarksAction);
const SAP = { id: "s1", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null };
const NONE: PriceMarksEditInfo = { marks: null, latestPrice: "100", analystTarget: null };

beforeEach(() => {
  set.mockReset();
});

function renderDialog(info: PriceMarksEditInfo = NONE) {
  const onClose = vi.fn();
  render(<PriceMarksDialog open onClose={onClose} formKey={1} security={SAP} info={info} today={TODAY} />);
  return { onClose, dialog: screen.getByRole("dialog", { name: "Kursmarken bearbeiten" }), user: userEvent.setup({ delay: null }) };
}

const text = (node: HTMLElement) => node.textContent?.replace(/ /g, " ");

describe("PriceMarksDialog", () => {
  it("sets a fixed stop and a target, dates default to today", async () => {
    set.mockResolvedValue({ ok: true, marks: null });
    const { dialog, onClose, user } = renderDialog();
    expect(within(dialog).getByText(/gegen den letzten Kurs geprüft, nicht im Tagesverlauf/)).toBeDefined();
    await user.click(within(dialog).getByRole("combobox", { name: "Stopp" }));
    await user.click(await screen.findByRole("option", { name: "Fester Kurs" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Stoppkurs (€)" }), "92,40");
    await user.type(within(dialog).getByRole("textbox", { name: "Quelle des Stopps" }), "Börse Online");
    await user.type(within(dialog).getByRole("textbox", { name: "Kursziel (€)" }), "120");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(formEntries(set.mock.calls[0][1])).toEqual({
      priceMarks: "1",
      securityId: "s1",
      stopType: "FIXED",
      stopValue: "92,40",
      stopSource: "Börse Online",
      stopSetDate: TODAY,
      targetPrice: "120",
      targetSource: "",
      targetSetDate: TODAY,
    });
  }, SLOW);

  it("shows the stored marks and clears them with 'Kein Stopp' and an empty target", async () => {
    set.mockResolvedValue({ ok: true, marks: null });
    const { dialog, onClose, user } = renderDialog({
      marks: {
        securityId: "s1",
        stop: { type: "TRAILING", value: "7.5", source: "Analyst", setDate: "2026-10-01" },
        target: { price: "245", source: null, setDate: "2026-10-02" },
      },
      latestPrice: "200",
      analystTarget: null,
    });
    expect((within(dialog).getByRole("textbox", { name: "Abstand zum Hoch (%)" }) as HTMLInputElement).value).toBe("7,5");
    expect((within(dialog).getByLabelText("Stopp gesetzt am") as HTMLInputElement).value).toBe("2026-10-01");
    expect((within(dialog).getByRole("textbox", { name: "Kursziel (€)" }) as HTMLInputElement).value).toBe("245");
    expect((within(dialog).getByLabelText("Ziel gesetzt am") as HTMLInputElement).value).toBe("2026-10-02");
    await user.click(within(dialog).getByRole("combobox", { name: "Stopp" }));
    await user.click(await screen.findByRole("option", { name: "Kein Stopp" }));
    expect(within(dialog).queryByRole("textbox", { name: "Abstand zum Hoch (%)" })).toBeNull();
    await user.clear(within(dialog).getByRole("textbox", { name: "Kursziel (€)" }));
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(formEntries(set.mock.calls[0][1])).toMatchObject({ stopType: "", targetPrice: "" });
  }, SLOW);

  it("fills an EUR analyst target with one click", async () => {
    const { dialog, user } = renderDialog({ marks: null, latestPrice: "200", analystTarget: { mean: "245", currency: "EUR" } });
    const button = within(dialog).getByRole("button", { name: /Analystenziel übernehmen/ });
    expect(text(button)).toBe("Analystenziel übernehmen (245,00 €)");
    await user.click(button);
    expect((within(dialog).getByRole("textbox", { name: "Kursziel (€)" }) as HTMLInputElement).value).toBe("245");
  });

  it("shows an analyst target in another currency only as a hint", () => {
    const { dialog } = renderDialog({ marks: null, latestPrice: "200", analystTarget: { mean: "245", currency: "USD" } });
    expect(within(dialog).queryByRole("button", { name: /Analystenziel übernehmen/ })).toBeNull();
    expect(text(within(dialog).getByText(/^Analystenziel:/))).toBe("Analystenziel: 245,00 USD – andere Währung, nicht übernehmbar");
  });

  it("shows nothing about analysts without a target", () => {
    const { dialog } = renderDialog();
    expect(within(dialog).queryByText(/Analystenziel/)).toBeNull();
  });

  it("warns, without blocking, about a stop above and a target below the latest Price", async () => {
    set.mockResolvedValue({ ok: true, marks: null });
    const { dialog, onClose, user } = renderDialog();
    await user.click(within(dialog).getByRole("combobox", { name: "Stopp" }));
    await user.click(await screen.findByRole("option", { name: "Fester Kurs" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Stoppkurs (€)" }), "110");
    await user.type(within(dialog).getByRole("textbox", { name: "Kursziel (€)" }), "90");
    expect(within(dialog).getByText(/Der Stopp liegt über dem letzten Kurs/)).toBeDefined();
    expect(within(dialog).getByText(/Das Ziel liegt unter dem letzten Kurs/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  }, SLOW);

  it("shows a refused field on that field and keeps the dialog open", async () => {
    set.mockResolvedValue({ ok: false, reason: "price-marks-invalid", field: "stopValue", problem: "out-of-range" });
    const { dialog, onClose, user } = renderDialog();
    await user.click(within(dialog).getByRole("combobox", { name: "Stopp" }));
    await user.click(await screen.findByRole("option", { name: "Nachlaufend" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Abstand zum Hoch (%)" }), "60");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte 1 bis 50 % eingeben.")).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  }, SLOW);

  it("moves a mark's set date to today when its level changes", async () => {
    const { dialog, user } = renderDialog({
      marks: { securityId: "s1", stop: null, target: { price: "245", source: null, setDate: "2026-10-02" } },
      latestPrice: "200",
      analystTarget: null,
    });
    await user.type(within(dialog).getByRole("textbox", { name: "Kursziel (€)" }), "0");
    expect((within(dialog).getByLabelText("Ziel gesetzt am") as HTMLInputElement).value).toBe(TODAY);
  });
});
