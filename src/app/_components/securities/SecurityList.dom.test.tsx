// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { SecurityWithMapping } from "@/modules/prices";
import { SecurityList } from "./SecurityList";

vi.mock("@/app/_actions/securities", () => ({
  resolveMissingMappingsAction: vi.fn(),
  resolveMappingAction: vi.fn(),
  setMappingAction: vi.fn(),
  changeSecurityTypeAction: vi.fn(),
}));

registerDomCleanup();

const securities: SecurityWithMapping[] = [
  { id: "s1", name: "Bitcoin", isin: null, cryptoSymbol: "BTC", assetType: "CRYPTO", mapping: null },
  { id: "s2", name: "SAP", isin: "DE0007164600", cryptoSymbol: null, assetType: "UNCLASSIFIED", mapping: null },
];

async function offeredTypes(name: string) {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole("button", { name: `Typ ändern – ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: "Typ ändern" });
  await user.click(within(dialog).getByRole("combobox", { name: "Typ" }));
  const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  return options;
}

describe("SecurityList", () => {
  it("offers the types allowed for each identifier in 'Typ ändern'", async () => {
    render(<SecurityList securities={securities} />);
    expect(await offeredTypes("SAP")).toEqual(["Aktie", "ETF", "Fonds", "Zertifikat"]);
    await screen.findByRole("button", { name: "Typ ändern – Bitcoin" });
    expect(await offeredTypes("Bitcoin")).toEqual(["Krypto"]);
  });
});
