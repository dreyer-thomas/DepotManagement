// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { PriceMarkWarning } from "./PriceMarkWarning";

registerDomCleanup();

function renderWarning(breach: "stop" | "target") {
  render(
    <ThemeProvider theme={theme}>
      <PriceMarkWarning info={{ breach, priceDate: "2026-11-10" }} />
    </ThemeProvider>,
  );
}

describe("PriceMarkWarning", () => {
  it("names a breached stop in words, is focusable and shows the same text as tooltip", async () => {
    renderWarning("stop");
    const icon = screen.getByRole("img", { name: "Stopp unterschritten · Kurs vom 10.11.2026" });
    expect(icon.getAttribute("tabindex")).toBe("0");
    expect(icon.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const user = userEvent.setup({ delay: null });
    await user.tab();
    expect(document.activeElement).toBe(icon);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Stopp unterschritten · Kurs vom 10.11.2026");
  });

  it("names a reached target", () => {
    renderWarning("target");
    expect(screen.getByRole("img", { name: "Ziel erreicht · Kurs vom 10.11.2026" })).toBeDefined();
  });
});
