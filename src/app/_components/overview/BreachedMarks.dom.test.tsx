// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { BreachedPriceMark } from "@/modules/marks";
import { theme } from "@/theme/theme";
import { LogoProvider } from "../securities/LogoContext";
import { BreachedMarks } from "./BreachedMarks";

registerDomCleanup();

const HELD_STOP: BreachedPriceMark = {
  securityId: "s1",
  name: "SAP SE",
  held: true,
  marks: { securityId: "s1", stop: { type: "FIXED", value: "90", source: null, setDate: "2026-10-01" }, target: { price: "130", source: null, setDate: "2026-10-01" } },
  state: {
    price: "85",
    priceDate: "2026-11-10",
    stop: { effective: "90", high: null, distance: "0.0588" },
    target: { price: "130", distance: "0.5294" },
    breached: "stop",
  },
};

const WATCHED_TARGET: BreachedPriceMark = {
  securityId: "s2",
  name: "Apple Inc.",
  held: false,
  marks: { securityId: "s2", stop: null, target: { price: "120", source: "Analyst", setDate: "2026-10-01" } },
  state: { price: "125", priceDate: "2026-11-10", stop: null, target: { price: "120", distance: "-0.04" }, breached: "target" },
};

function renderCard(items: BreachedPriceMark[]) {
  return render(
    <ThemeProvider theme={theme}>
      <LogoProvider versions={{}}>
        <BreachedMarks items={items} />
      </LogoProvider>
    </ThemeProvider>,
  );
}

const text = (node: Element) => node.textContent?.replace(/\u00a0/g, " ") ?? "";

describe("BreachedMarks", () => {
  it("lists a breached stop (held) and a reached target (watched) with pill, mark, distance, latest Price and link", () => {
    renderCard([HELD_STOP, WATCHED_TARGET]);
    const card = screen.getByRole("region", { name: "Kursmarken erreicht" });
    const [stopRow, targetRow] = within(card).getAllByRole("listitem");
    expect(text(stopRow)).toBe("SSSAP SEStopp unterschritten · Kurs vom 10.11.2026im DepotStopp · 90,00 € · +5,9 %Letzter Kurs 85,00 €");
    expect(text(targetRow)).toBe("AIApple Inc.Ziel erreicht · Kurs vom 10.11.2026Ziel · 120,00 € · -4,0 %Letzter Kurs 125,00 €");
    expect(stopRow.querySelector("[data-breach-pill]")).not.toBeNull();
    expect(within(stopRow).getByRole("link", { name: "SAP SE" }).getAttribute("href")).toBe("/securities/s1");
    expect(within(targetRow).getByRole("link", { name: "Apple Inc." }).getAttribute("href")).toBe("/securities/s2");
  });

  it("renders nothing without a breached mark", () => {
    const { container } = renderCard([]);
    expect(container.innerHTML).toBe("");
  });
});
