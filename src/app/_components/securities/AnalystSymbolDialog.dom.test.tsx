// @vitest-environment happy-dom
import { render, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { setAnalystSymbolAction } from "@/app/_actions/classification";
import { AnalystSymbolButton } from "./AnalystSymbolDialog";

vi.mock("@/app/_actions/classification", () => ({ setAnalystSymbolAction: vi.fn() }));

registerDomCleanup();

const save = vi.mocked(setAnalystSymbolAction);

beforeEach(() => {
  save.mockReset();
});

const security = { id: "a1", name: "Apple Inc." };

async function open(symbol: string | null = "AAPL") {
  const user = userEvent.setup({ delay: null });
  render(<AnalystSymbolButton security={security} symbol={symbol} />);
  await user.click(screen.getByRole("button", { name: "Analysten-Symbol bearbeiten – Apple Inc." }));
  const dialog = await screen.findByRole("dialog", { name: "Analysten-Symbol" });
  const field = within(dialog).getByRole("textbox", { name: "Analysten-Symbol" }) as HTMLInputElement;
  return { user, dialog, field };
}

describe("AnalystSymbolButton", () => {
  it("prefills the symbol, explains the automatic mode and saves the input", async () => {
    save.mockResolvedValue({ ok: true });
    const { user, dialog, field } = await open();
    expect(field.value).toBe("AAPL");
    expect(within(dialog).getByText("Leer lassen = automatisch per ISIN ermitteln")).toBeTruthy();
    await user.clear(field);
    await user.type(field, "nvda");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(save).toHaveBeenCalledWith("a1", "nvda");
  });

  it("saves an empty field (automatic)", async () => {
    save.mockResolvedValue({ ok: true });
    const { user, dialog, field } = await open(null);
    expect(field.value).toBe("");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(save).toHaveBeenCalledWith("a1", "");
  });

  it("shows the German error and stays open", async () => {
    save.mockResolvedValue({ ok: false, reason: "symbol-invalid" });
    const { user, dialog, field } = await open();
    await user.type(field, " x");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Ungültiges Symbol")).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    save.mockRejectedValue(new Error("network"));
    const button = within(dialog).getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    // The first save's transition must be over before the button accepts the next click.
    await waitFor(() => expect(button.disabled).toBe(false));
    await user.click(button);
    expect(await within(dialog).findByText("Verbindung fehlgeschlagen. Bitte erneut versuchen.")).toBeTruthy();
  });
});
