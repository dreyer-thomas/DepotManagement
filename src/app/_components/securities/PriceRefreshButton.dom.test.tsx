// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { refreshPricesAction } from "@/app/_actions/prices";
import { PriceRefreshButton } from "./PriceRefreshButton";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/_actions/prices", () => ({ refreshPricesAction: vi.fn(), saveManualPriceAction: vi.fn() }));

registerDomCleanup();

const action = vi.mocked(refreshPricesAction);
type Result = Awaited<ReturnType<typeof refreshPricesAction>>;

beforeEach(() => {
  action.mockReset();
  refresh.mockReset();
});

describe("PriceRefreshButton", () => {
  it("is disabled with progress until the action returns, then names the failures and refreshes", async () => {
    let finish: (value: Result) => void = () => {};
    action.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup({ delay: null });
    render(<PriceRefreshButton />);
    await user.click(screen.getByRole("button", { name: "Kurse aktualisieren" }));
    const busy = screen.getByRole("button", { name: /Kurse werden aktualisiert/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector('[role="progressbar"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(refresh).not.toHaveBeenCalled();

    finish({
      ok: true,
      updated: 1,
      failed: [{ securityId: "s2", name: "NVIDIA", provider: "YAHOO", reason: "network" }],
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Kurse aktualisiert. Fehlgeschlagen: NVIDIA");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Kurse aktualisieren" }) as HTMLButtonElement).disabled).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("confirms a run without failures", async () => {
    action.mockResolvedValue({ ok: true, updated: 2, failed: [] });
    const user = userEvent.setup({ delay: null });
    render(<PriceRefreshButton />);
    await user.click(screen.getByRole("button", { name: "Kurse aktualisieren" }));
    expect((await screen.findByRole("status")).textContent).toContain("Kurse aktualisiert.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the session message without refreshing when unauthorized", async () => {
    action.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const user = userEvent.setup({ delay: null });
    render(<PriceRefreshButton />);
    await user.click(screen.getByRole("button", { name: "Kurse aktualisieren" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Sitzung abgelaufen. Bitte erneut anmelden.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the connection message when the action is rejected", async () => {
    action.mockRejectedValue(new Error("network"));
    const user = userEvent.setup({ delay: null });
    render(<PriceRefreshButton />);
    await user.click(screen.getByRole("button", { name: "Kurse aktualisieren" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
    await waitFor(() => expect((screen.getByRole("button", { name: "Kurse aktualisieren" }) as HTMLButtonElement).disabled).toBe(false));
    expect(refresh).not.toHaveBeenCalled();
  });
});
