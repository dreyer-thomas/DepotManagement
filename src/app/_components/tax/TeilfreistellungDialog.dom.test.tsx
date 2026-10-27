// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { setTeilfreistellungAction } from "@/app/_actions/tax";
import { TeilfreistellungButton } from "./TeilfreistellungDialog";

vi.mock("@/app/_actions/tax", () => ({ setTeilfreistellungAction: vi.fn() }));

registerDomCleanup();

const save = vi.mocked(setTeilfreistellungAction);

beforeEach(() => {
  save.mockReset();
});

const security = { id: "f1", name: "MSCI World" };

async function open(override: string | null = null) {
  const user = userEvent.setup({ delay: null });
  render(<TeilfreistellungButton security={security} automaticRate="0.3" override={override} />);
  await user.click(screen.getByRole("button", { name: "Teilfreistellung bearbeiten – MSCI World" }));
  const dialog = await screen.findByRole("dialog", { name: "Teilfreistellung bearbeiten" });
  return { user, dialog };
}

describe("TeilfreistellungButton", () => {
  it("offers 'Automatisch (30 %)' and the rates, and saves the chosen rate", async () => {
    save.mockResolvedValue({ ok: true });
    const { user, dialog } = await open();
    const select = within(dialog).getByRole("combobox", { name: "Teilfreistellung" });
    expect(select.textContent).toBe("Automatisch (30 %)");
    await user.click(select);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Automatisch (30 %)",
      "0 %",
      "15 %",
      "30 %",
      "60 %",
      "80 %",
    ]);
    await user.click(screen.getByRole("option", { name: "0 %" }));
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(formEntries(save.mock.calls[0][1])).toEqual({ securityId: "f1", rate: "0" });
  });

  it("starts from the stored override and shows an error", async () => {
    save.mockResolvedValue({ ok: false, reason: "rate-invalid" });
    const { user, dialog } = await open("0.15");
    expect(within(dialog).getByRole("combobox", { name: "Teilfreistellung" }).textContent).toBe("15 %");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Bitte einen Satz aus der Liste wählen.");
  });
});
