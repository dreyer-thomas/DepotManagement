// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { setRegionSplitAction } from "@/app/_actions/classification";
import { RegionSplitButton } from "./RegionSplitDialog";

vi.mock("@/app/_actions/classification", () => ({ setRegionSplitAction: vi.fn() }));

registerDomCleanup();

const save = vi.mocked(setRegionSplitAction);

beforeEach(() => {
  save.mockReset();
});

const security = { id: "f1", name: "MSCI World" };
const WORLD = [
  { region: "USA" as const, weight: "72" },
  { region: "Europa" as const, weight: "15" },
  { region: "Japan" as const, weight: "6" },
  { region: "Pazifik ohne Japan" as const, weight: "4" },
  { region: "Sonstige" as const, weight: "2.5" },
  { region: "Schwellenländer" as const, weight: "0.5" },
];

async function open(weights: typeof WORLD | null = WORLD) {
  const user = userEvent.setup({ delay: null });
  render(<RegionSplitButton security={security} weights={weights} />);
  await user.click(screen.getByRole("button", { name: "Regionen bearbeiten – MSCI World" }));
  const dialog = await screen.findByRole("dialog", { name: "Regionen bearbeiten" });
  return { user, dialog };
}

const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole("textbox", { name }) as HTMLInputElement;

describe("RegionSplitButton", () => {
  it("prefills six percent fields with the effective split and shows the live sum", async () => {
    const { user, dialog } = await open();
    expect(within(dialog).getAllByRole("textbox").map((input) => [input.getAttribute("name"), (input as HTMLInputElement).value])).toEqual([
      ["split-0", "72"],
      ["split-1", "15"],
      ["split-2", "6"],
      ["split-3", "4"],
      ["split-4", "0,5"],
      ["split-5", "2,5"],
    ]);
    expect(field(dialog, "USA").getAttribute("inputmode")).toBe("decimal");
    expect(within(dialog).getByText("Summe: 100 %")).toBeTruthy();
    await user.clear(field(dialog, "USA"));
    await user.type(field(dialog, "USA"), "71,5");
    expect(within(dialog).getByText("Summe: 99,5 %")).toBeTruthy();
    await user.type(field(dialog, "Japan"), "x");
    expect(within(dialog).getByText("Summe: –")).toBeTruthy();
  });

  it("saves the fields and closes", async () => {
    save.mockResolvedValue({ ok: true, manual: null });
    const { user, dialog } = await open(null);
    expect(within(dialog).getByText("Summe: 0 %")).toBeTruthy();
    await user.type(field(dialog, "USA"), "60");
    await user.type(field(dialog, "Europa"), "40");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(formEntries(save.mock.calls[0][1])).toEqual({
      securityId: "f1",
      "split-0": "60",
      "split-1": "40",
      "split-2": "",
      "split-3": "",
      "split-4": "",
      "split-5": "",
    });
  });

  it("'Automatisch' submits every field empty", async () => {
    save.mockResolvedValue({ ok: true, manual: null });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Automatisch" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(formEntries(save.mock.calls[0][1])).toEqual({
      securityId: "f1",
      "split-0": "",
      "split-1": "",
      "split-2": "",
      "split-3": "",
      "split-4": "",
      "split-5": "",
    });
  });

  it("shows the German error and stays open", async () => {
    save.mockResolvedValue({ ok: false, reason: "split-sum" });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Die Anteile müssen zusammen 100 % ergeben.");
    save.mockResolvedValue({ ok: false, reason: "split-invalid" });
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte je Region einen Anteil von 0 bis 100 % mit höchstens zwei Nachkommastellen eingeben.")).toBeTruthy();
    save.mockRejectedValue(new Error("network"));
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByText("Verbindung fehlgeschlagen. Bitte erneut versuchen."))).toBeTruthy();
  });
});
