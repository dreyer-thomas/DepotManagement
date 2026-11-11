// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { PriceMarks, PriceMarkState } from "@/core/price-marks";
import { theme } from "@/theme/theme";
import { PriceMarksCard } from "./PriceMarksCard";

vi.mock("@/app/_actions/price-marks", () => ({ setPriceMarksAction: vi.fn() }));

registerDomCleanup();

const TODAY = "2026-11-11";
const SAP = { id: "s1", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null };
const NO_STATE: PriceMarkState = { price: null, priceDate: null, stop: null, target: null, breached: "none" };

function renderCard(marks: PriceMarks | null, state: PriceMarkState = NO_STATE) {
  render(
    <ThemeProvider theme={theme}>
      <PriceMarksCard security={SAP} info={{ marks, latestPrice: state.price, analystTarget: null }} state={state} today={TODAY} />
    </ThemeProvider>,
  );
  return screen.getByRole("region", { name: "Kursmarken" });
}

const text = (node: HTMLElement) => node.textContent?.replace(/ /g, " ") ?? "";

describe("PriceMarksCard", () => {
  it("without marks shows only Keine Kursmarken and the button", () => {
    const card = renderCard(null);
    expect(within(card).getByText("Keine Kursmarken")).toBeDefined();
    expect(within(card).getByRole("button", { name: "Kursmarken bearbeiten" })).toBeDefined();
    expect(text(card)).not.toContain("geprüft gegen den letzten Kurs");
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows a fixed stop with value, distance, source and set date, plus the note", () => {
    const card = renderCard(
      { securityId: "s1", stop: { type: "FIXED", value: "92.4", source: "Börse Online", setDate: "2026-10-01" }, target: null },
      { price: "99.78", priceDate: "2026-11-10", stop: { effective: "92.4", high: null, distance: "-0.074" }, target: null, breached: "none" },
    );
    const [row] = within(card).getAllByRole("listitem");
    expect(text(row)).toBe("Stopp · 92,40 € · -7,4 %Quelle: Börse Online · gesetzt am 01.10.2026");
    expect(text(card)).toContain("geprüft gegen den letzten Kurs, nicht im Tagesverlauf");
    expect(card.querySelector("[data-breach-pill]")).toBeNull();
  });

  it("shows a trailing stop with its percent and effective value; without a Price 'noch kein Kurs'", () => {
    const trailing: PriceMarks = { securityId: "s1", stop: { type: "TRAILING", value: "15", source: null, setDate: "2026-10-01" }, target: null };
    const card = renderCard(trailing, {
      price: "105",
      priceDate: "2026-10-03",
      stop: { effective: "93.5", high: "110", distance: "-0.1095" },
      target: null,
      breached: "none",
    });
    expect(text(within(card).getAllByRole("listitem")[0])).toBe("Stopp nachlaufend 15 % · 93,50 € · -11,0 %gesetzt am 01.10.2026");
  });

  it("shows a trailing stop without any Price", () => {
    const card = renderCard(
      { securityId: "s1", stop: { type: "TRAILING", value: "12.5", source: null, setDate: "2026-10-01" }, target: null },
      { ...NO_STATE, stop: { effective: null, high: null, distance: null } },
    );
    expect(text(within(card).getAllByRole("listitem")[0])).toContain("Stopp nachlaufend 12,5 % · noch kein Kurs");
  });

  it("marks a breached stop with the pill on the stop row only", () => {
    const card = renderCard(
      {
        securityId: "s1",
        stop: { type: "FIXED", value: "100", source: null, setDate: "2026-10-01" },
        target: { price: "245", source: "Analyst", setDate: "2026-10-02" },
      },
      {
        price: "95",
        priceDate: "2026-11-10",
        stop: { effective: "100", high: null, distance: "0.0526" },
        target: { price: "245", distance: "1.5789" },
        breached: "stop",
      },
    );
    const [stop, target] = within(card).getAllByRole("listitem");
    expect(text(stop)).toContain("Stopp unterschritten · Kurs vom 10.11.2026");
    expect(text(target)).toBe("Ziel · 245,00 € · +157,9 %Quelle: Analyst · gesetzt am 02.10.2026");
    expect(card.querySelectorAll("[data-breach-pill]")).toHaveLength(1);
  });

  it("marks a reached target with the pill", () => {
    const card = renderCard(
      { securityId: "s1", stop: null, target: { price: "245", source: null, setDate: "2026-10-02" } },
      { price: "250", priceDate: "2026-11-10", stop: null, target: { price: "245", distance: "-0.02" }, breached: "target" },
    );
    const [target] = within(card).getAllByRole("listitem");
    expect(text(target)).toContain("Ziel · 245,00 € · -2,0 %");
    expect(text(target)).toContain("Ziel erreicht · Kurs vom 10.11.2026");
  });

  it("opens Kursmarken bearbeiten prefilled from the button", async () => {
    const user = userEvent.setup({ delay: null });
    const card = renderCard(
      { securityId: "s1", stop: null, target: { price: "245", source: null, setDate: "2026-10-02" } },
      { price: "200", priceDate: "2026-11-10", stop: null, target: { price: "245", distance: "0.225" }, breached: "none" },
    );
    await user.click(within(card).getByRole("button", { name: "Kursmarken bearbeiten" }));
    const dialog = await screen.findByRole("dialog", { name: "Kursmarken bearbeiten" });
    expect((within(dialog).getByRole("textbox", { name: "Kursziel (€)" }) as HTMLInputElement).value).toBe("245");
  });
});
