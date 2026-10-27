// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { setTaxAllowancesAction } from "@/app/_actions/tax";
import { AllowanceForm } from "./AllowanceForm";

vi.mock("@/app/_actions/tax", () => ({ setTaxAllowancesAction: vi.fn() }));

registerDomCleanup();

const save = vi.mocked(setTaxAllowancesAction);

beforeEach(() => {
  save.mockReset();
});

const ALLOWANCES = [
  { broker: "COMDIRECT" as const, year: 2026, amount: "801" },
  { broker: "DEUTSCHE_BANK" as const, year: 2026, amount: "300.5" },
  { broker: "COMDIRECT" as const, year: 2025, amount: "1000" },
];
const HINT = /übersteigt 1\.000 €/;

const field = (label: string) => screen.getByRole("textbox", { name: label }) as HTMLInputElement;

describe("AllowanceForm", () => {
  it("shows the year's stored amounts per broker and the years from next year to the first ledger year", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AllowanceForm allowances={ALLOWANCES} firstYear={2024} todayYear={2026} />);
    expect(field("comdirect (€)").value).toBe("801");
    expect(field("Deutsche Bank (€)").value).toBe("300,50");
    expect(field("finanzen.net zero (€)").value).toBe("");
    expect(screen.getByRole("status").textContent).toMatch(HINT);

    await user.click(screen.getByRole("combobox", { name: "Jahr" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["2027", "2026", "2025", "2024"]);
    await user.click(screen.getByRole("option", { name: "2025" }));
    expect(field("comdirect (€)").value).toBe("1000");
    expect(field("Deutsche Bank (€)").value).toBe("");
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("updates the > 1.000 € hint live and saves the year with every field", async () => {
    save.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    render(<AllowanceForm allowances={[]} firstYear={2026} todayYear={2026} />);
    expect(screen.queryByText(HINT)).toBeNull();
    await user.type(field("comdirect (€)"), "801");
    await user.type(field("Deutsche Bank (€)"), "199");
    expect(screen.queryByText(HINT)).toBeNull();
    await user.type(field("finanzen.net zero (€)"), "0,01");
    expect(screen.getByText(HINT)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gespeichert.")).toBeTruthy();
    expect(formEntries(save.mock.calls[0][1])).toEqual({
      year: "2026",
      "amount-COMDIRECT": "801",
      "amount-DEUTSCHE_BANK": "199",
      "amount-FINANZEN_ZERO": "0,01",
    });
  });

  it("shows the field error of the invalid broker", async () => {
    save.mockResolvedValue({ ok: false, reason: "amount-invalid", broker: "DEUTSCHE_BANK" });
    const user = userEvent.setup({ delay: null });
    render(<AllowanceForm allowances={[]} firstYear={2026} todayYear={2026} />);
    await user.type(field("Deutsche Bank (€)"), "1,234");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Bitte einen Betrag ab 0 mit höchstens zwei Nachkommastellen eingeben.")).toBeTruthy();
    expect(field("Deutsche Bank (€)").getAttribute("aria-invalid")).toBe("true");
    expect(field("comdirect (€)").getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText("Gespeichert.")).toBeNull();
  });
});
