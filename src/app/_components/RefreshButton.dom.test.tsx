// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../test/helpers/dom";
import { RefreshButton, refreshAllText } from "./RefreshButton";

const refresh = vi.hoisted(() => vi.fn());
const refreshAllAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../_actions/refresh", () => ({ refreshAllAction }));

registerDomCleanup();

describe("refreshAllText", () => {
  it("confirms success and names failed Prices and news", () => {
    expect(refreshAllText({ ok: true, failedPrices: [], failedNews: [] })).toEqual({
      severity: "success",
      text: "Kurse und Nachrichten aktualisiert.",
    });
    expect(refreshAllText({ ok: true, failedPrices: ["SAP SE", "Beispiel AG"], failedNews: ["Yolo AG"] })).toEqual({
      severity: "warning",
      text: "Aktualisiert. Kurse fehlgeschlagen: SAP SE, Beispiel AG. Nachrichten fehlgeschlagen: Yolo AG.",
    });
    expect(refreshAllText({ ok: true, failedPrices: [], failedNews: null }).text).toBe(
      "Aktualisiert. Nachrichten konnten nicht geladen werden.",
    );
    expect(refreshAllText({ ok: false, reason: "unauthorized" })).toEqual({
      severity: "error",
      text: "Sitzung abgelaufen. Bitte erneut anmelden.",
    });
  });
});

describe("RefreshButton", () => {
  it("is an unlabelled icon button that refreshes, reports the outcome and reloads the page", async () => {
    let finish: (value: unknown) => void = () => {};
    refreshAllAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup({ delay: null });
    render(<RefreshButton />);
    const button = screen.getByRole("button", { name: "Kurse und Nachrichten aktualisieren" });
    expect(button.textContent).toBe("");

    await user.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);

    finish({ ok: true, failedPrices: [], failedNews: [] });
    expect((await screen.findByRole("status")).textContent).toContain("Kurse und Nachrichten aktualisiert.");
    expect(refresh).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a connection error when the action throws", async () => {
    refreshAllAction.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup({ delay: null });
    render(<RefreshButton />);
    await user.click(screen.getByRole("button", { name: "Kurse und Nachrichten aktualisieren" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });
});
