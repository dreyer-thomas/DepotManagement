// @vitest-environment happy-dom
import { render, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { changeSecurityTypeAction, resolveMappingAction, setMappingAction } from "@/app/_actions/securities";
import { MappingDialogButton, ResolveMappingButton } from "./MappingDialog";
import { TypeDialogButton } from "./TypeDialog";

vi.mock("@/app/_actions/securities", () => ({
  resolveMissingMappingsAction: vi.fn(),
  resolveMappingAction: vi.fn(),
  setMappingAction: vi.fn(),
  changeSecurityTypeAction: vi.fn(),
}));

registerDomCleanup();

const setMapping = vi.mocked(setMappingAction);
const changeType = vi.mocked(changeSecurityTypeAction);
const resolveOne = vi.mocked(resolveMappingAction);

beforeEach(() => {
  setMapping.mockReset();
  changeType.mockReset();
  resolveOne.mockReset();
});

const msci = { id: "s1", name: "iShares Core MSCI World", mapping: { provider: null, symbol: null, origin: "AUTO" as const, fetchError: null } };

async function openMappingDialog(security: Parameters<typeof MappingDialogButton>[0]["security"] = msci) {
  const user = userEvent.setup({ delay: null });
  render(<MappingDialogButton security={security} />);
  await user.click(screen.getByRole("button", { name: `Kursquelle bearbeiten – ${security.name}` }));
  const dialog = await screen.findByRole("dialog", { name: "Kursquelle bearbeiten" });
  return { user, dialog };
}

describe("MappingDialogButton", () => {
  it("saves provider and symbol and closes", async () => {
    setMapping.mockResolvedValue({ ok: true, mapping: { provider: "YAHOO", symbol: "EUNL.DE", origin: "MANUAL", fetchError: null } });
    const { user, dialog } = await openMappingDialog();
    await user.click(within(dialog).getByRole("combobox", { name: "Kursquelle" }));
    await user.click(await screen.findByRole("option", { name: "Yahoo Finance" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Symbol" }), "EUNL.DE");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(formEntries(setMapping.mock.calls[0][1])).toEqual({ securityId: "s1", provider: "YAHOO", symbol: "EUNL.DE" });
  });

  it("keeps the input and shows the field error on a rejected symbol", async () => {
    setMapping.mockResolvedValue({ ok: false, reason: "symbol-invalid" });
    const { user, dialog } = await openMappingDialog();
    await user.click(within(dialog).getByRole("combobox", { name: "Kursquelle" }));
    await user.click(await screen.findByRole("option", { name: "onvista" }));
    const symbol = within(dialog).getByRole("textbox", { name: "Symbol" }) as HTMLInputElement;
    await user.type(symbol, "EUNL DE");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText(/Bitte ein Symbol eingeben/)).toBeTruthy();
    expect(symbol.value).toBe("EUNL DE");
    expect(within(dialog).getByRole("combobox", { name: "Kursquelle" }).textContent).toBe("onvista");
    expect(dialog.isConnected).toBe(true);
  });

  it("prefills the current mapping and shows non-field failures in an Alert", async () => {
    setMapping.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const { user, dialog } = await openMappingDialog({
      id: "s2",
      name: "SAP",
      mapping: { provider: "YAHOO", symbol: "SAP.DE", origin: "AUTO", fetchError: null },
    });
    expect((within(dialog).getByRole("textbox", { name: "Symbol" }) as HTMLInputElement).value).toBe("SAP.DE");
    expect(within(dialog).getByRole("combobox", { name: "Kursquelle" }).textContent).toBe("Yahoo Finance");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
  });
});

describe("TypeDialogButton", () => {
  const security = { id: "s3", name: "Unbekannt AG", assetType: "UNCLASSIFIED" as const };

  it("offers only the allowed types, never 'Typ unbekannt', and saves the choice", async () => {
    changeType.mockResolvedValue({
      ok: true,
      security: { ...security, assetType: "ETF", isin: "LU0274208692", cryptoSymbol: null },
    });
    const user = userEvent.setup({ delay: null });
    render(<TypeDialogButton security={security} allowedTypes={["STOCK", "ETF", "FUND", "CERTIFICATE"]} />);
    await user.click(screen.getByRole("button", { name: "Typ ändern – Unbekannt AG" }));
    const dialog = await screen.findByRole("dialog", { name: "Typ ändern" });
    await user.click(within(dialog).getByRole("combobox", { name: "Typ" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Aktie", "ETF", "Fonds", "Zertifikat"]);
    await user.click(screen.getByRole("option", { name: "ETF" }));
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
    expect(formEntries(changeType.mock.calls[0][1])).toEqual({ securityId: "s3", assetType: "ETF" });
  });

  it("keeps the selection and shows the error when the type is rejected", async () => {
    changeType.mockResolvedValue({ ok: false, reason: "asset-type-invalid" });
    const user = userEvent.setup({ delay: null });
    render(<TypeDialogButton security={{ ...security, assetType: "STOCK" }} allowedTypes={["STOCK", "ETF", "FUND", "CERTIFICATE"]} />);
    await user.click(screen.getByRole("button", { name: "Typ ändern – Unbekannt AG" }));
    const dialog = await screen.findByRole("dialog", { name: "Typ ändern" });
    expect(within(dialog).getByRole("combobox", { name: "Typ" }).textContent).toBe("Aktie");
    await user.click(within(dialog).getByRole("combobox", { name: "Typ" }));
    await user.click(await screen.findByRole("option", { name: "Fonds" }));
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Bitte einen passenden Typ wählen.")).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Typ" }).textContent).toBe("Fonds");
  });

  it("offers only Krypto for a crypto Security", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TypeDialogButton security={{ id: "s4", name: "Bitcoin", assetType: "CRYPTO" }} allowedTypes={["CRYPTO"]} />);
    await user.click(screen.getByRole("button", { name: "Typ ändern – Bitcoin" }));
    const dialog = await screen.findByRole("dialog", { name: "Typ ändern" });
    await user.click(within(dialog).getByRole("combobox", { name: "Typ" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Krypto"]);
  });
});

describe("ResolveMappingButton", () => {
  it("submits the Security and shows a miss or a failure inline", async () => {
    resolveOne
      .mockResolvedValueOnce({ ok: true, status: "not-found" })
      .mockResolvedValueOnce({ ok: false, reason: "provider-failed" });
    const user = userEvent.setup({ delay: null });
    render(<ResolveMappingButton security={{ id: "s1", name: "iShares Core MSCI World" }} />);
    const button = screen.getByRole("button", { name: "Automatisch suchen – iShares Core MSCI World" });
    await user.click(button);
    expect((await screen.findByRole("status")).textContent).toBe("Weiterhin keine Kursquelle gefunden.");
    expect(formEntries(resolveOne.mock.calls[0][1])).toEqual({ securityId: "s1" });
    await user.click(button);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Kursquelle konnte gerade nicht ermittelt werden. Bitte später erneut versuchen."),
    );
  });
});
