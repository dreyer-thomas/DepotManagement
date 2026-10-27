// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { setTargetAllocationAction } from "@/app/_actions/rebalancing";
import type { Targets } from "@/core/rebalancing";
import { TargetForm } from "./TargetForm";

vi.mock("@/app/_actions/rebalancing", () => ({ setTargetAllocationAction: vi.fn() }));

registerDomCleanup();

const save = vi.mocked(setTargetAllocationAction);

beforeEach(() => {
  save.mockReset();
});

const TARGETS: Targets = {
  equityUsa: "60.5",
  equityEurope: "20",
  equityJapan: "0",
  equityPacificExJapan: "0",
  equityEmerging: "0",
  bonds: "19.5",
  commodities: "0",
  realEstate: "0",
  crypto: "0",
  cash: "0",
};

const field = (label: string) => screen.getByRole("textbox", { name: label }) as HTMLInputElement;

describe("TargetForm", () => {
  it("prefills the stored targets and threshold and shows the live sum", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TargetForm scope="portfolio" targets={TARGETS} threshold="1.5" />);
    expect(field("Aktien USA (%)").value).toBe("60,5");
    expect(field("Anleihen (%)").value).toBe("19,5");
    expect(field("Geldmarkt/Cash (%)").value).toBe("");
    expect(field("Schwelle (Prozentpunkte)").value).toBe("1,5");
    expect(screen.getByText("Summe: 100 %")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(11);

    await user.clear(field("Anleihen (%)"));
    await user.type(field("Anleihen (%)"), "19");
    expect(screen.getByText("Summe: 99,5 %")).toBeTruthy();
  });

  it("saves every field with the scope and confirms", async () => {
    save.mockResolvedValue({ ok: true, allocation: { targets: TARGETS, threshold: "2" } });
    const user = userEvent.setup({ delay: null });
    render(<TargetForm scope="d1" targets={null} threshold="2" />);
    expect(field("Schwelle (Prozentpunkte)").value).toBe("2");
    await user.type(field("Aktien Europa (%)"), "100");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Gespeichert.")).toBeTruthy();
    expect(formEntries(save.mock.calls[0][1])).toMatchObject({ scope: "d1", "target-equityEurope": "100", "target-equityUsa": "", threshold: "2" });
  });

  it("shows the sum error, a field error and the threshold error in German", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TargetForm scope="portfolio" targets={null} threshold="2" />);

    save.mockResolvedValueOnce({ ok: false, reason: "target-sum" });
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Die Zielwerte müssen zusammen 100 % ergeben.");

    save.mockResolvedValueOnce({ ok: false, reason: "target-invalid", segment: "bonds" });
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Bitte einen Wert von 0 bis 100 mit höchstens zwei Nachkommastellen eingeben.")).toBeTruthy();
    expect(field("Anleihen (%)").getAttribute("aria-invalid")).toBe("true");
    expect(field("Aktien USA (%)").getAttribute("aria-invalid")).toBe("false");

    save.mockResolvedValueOnce({ ok: false, reason: "threshold-invalid" });
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/Bitte eine Schwelle von 0 bis 100/)).toBeTruthy();
    expect(field("Schwelle (Prozentpunkte)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("Gespeichert.")).toBeNull();
  });
});
