// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { setClassificationAction } from "@/app/_actions/classification";
import { type Classification, effective, emptyLayer, emptyManual } from "@/core/classification";
import { ClassificationButton } from "./ClassificationDialog";

vi.mock("@/app/_actions/classification", () => ({ setClassificationAction: vi.fn() }));

registerDomCleanup();

const save = vi.mocked(setClassificationAction);

beforeEach(() => {
  save.mockReset();
});

const security = { id: "s1", name: "SAP SE" };

/** SAP with provider values, a rule asset class and a manual sector. */
function sap(): Classification {
  const automatic = emptyLayer();
  automatic.assetClass = { value: "Aktien", source: "RULE" };
  automatic.sector = { value: "Technologie", source: "PROVIDER" };
  automatic.industry = { value: "Software—Application", source: "PROVIDER" };
  automatic.region = { value: "Europa", source: "PROVIDER" };
  automatic.country = { value: "Deutschland", source: "PROVIDER" };
  automatic.companySize = { value: "Large Cap", source: "PROVIDER" };
  automatic.currency = { value: "EUR", source: "PROVIDER" };
  return effective({ automatic, manual: { ...emptyManual(), sector: "Halbleiter" } }, "STOCK");
}

async function open(classification: Classification = sap()) {
  const user = userEvent.setup({ delay: null });
  render(<ClassificationButton security={security} classification={classification} />);
  await user.click(screen.getByRole("button", { name: "Klassifizierung bearbeiten – SAP SE" }));
  const dialog = await screen.findByRole("dialog", { name: "Klassifizierung bearbeiten" });
  return { user, dialog };
}

describe("ClassificationButton", () => {
  it("shows the type read-only, the manual value and the automatic values with their source", async () => {
    const { dialog } = await open();
    expect(within(dialog).getByText("Typ: Aktie")).toBeTruthy();
    expect(within(dialog).getByText("Ändern über „Typ ändern“")).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Sektor" }).textContent).toBe("Halbleiter");
    expect(within(dialog).getByRole("combobox", { name: "Anlageklasse" }).textContent).toBe("Automatisch: Aktien (Regel)");
    expect(within(dialog).getByRole("combobox", { name: "Region" }).textContent).toBe("Automatisch: Europa (Yahoo)");
    expect((within(dialog).getByRole("textbox", { name: "Branche" }) as HTMLInputElement).value).toBe("");
    expect(within(dialog).getByText("Automatisch: Software—Application (Yahoo)")).toBeTruthy();
    expect(within(dialog).getByText("Automatisch: EUR (Yahoo)")).toBeTruthy();
  });

  it("saves overrides and 'Automatisch' as empty values, then closes", async () => {
    save.mockResolvedValue({ ok: true, classification: sap() });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("combobox", { name: "Sektor" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toContain("Automatisch: Technologie (Yahoo)");
    await user.click(screen.getByRole("option", { name: "Automatisch: Technologie (Yahoo)" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Region" }));
    await user.click(await screen.findByRole("option", { name: "USA" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Land" }), "USA");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(formEntries(save.mock.calls[0][1])).toEqual({
      securityId: "s1",
      assetClass: "",
      sector: "",
      industry: "",
      region: "USA",
      country: "USA",
      companySize: "",
      currency: "",
    });
  });

  it("offers the fixed lists for asset class, region and company size", async () => {
    const { user, dialog } = await open(effective(null, "ETF"));
    await user.click(within(dialog).getByRole("combobox", { name: "Unternehmensgröße" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Automatisch: Unbekannt",
      "Large Cap",
      "Mid Cap",
      "Small Cap",
      "–",
    ]);
  });

  it("keeps the input and shows a German field error", async () => {
    save.mockResolvedValue({ ok: false, reason: "currency-invalid" });
    const { user, dialog } = await open();
    const currency = within(dialog).getByRole("textbox", { name: "Währung" }) as HTMLInputElement;
    await user.type(currency, "eu1");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte einen Währungscode aus drei Buchstaben eingeben (z. B. EUR).")).toBeTruthy();
    expect(currency.value).toBe("eu1");
    expect(dialog.isConnected).toBe(true);
  });

  it("shows non-field failures in an Alert", async () => {
    save.mockRejectedValue(new Error("network"));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });
});
