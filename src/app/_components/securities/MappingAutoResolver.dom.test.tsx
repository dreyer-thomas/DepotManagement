// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { resolveMissingMappingsAction } from "@/app/_actions/securities";
import { MappingAutoResolver } from "./MappingAutoResolver";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/_actions/securities", () => ({
  resolveMissingMappingsAction: vi.fn(),
  resolveMappingAction: vi.fn(),
  setMappingAction: vi.fn(),
  changeSecurityTypeAction: vi.fn(),
}));

registerDomCleanup();

const resolveMissing = vi.mocked(resolveMissingMappingsAction);

beforeEach(() => {
  resolveMissing.mockReset();
  refresh.mockReset();
});

describe("MappingAutoResolver", () => {
  it("does nothing when no Security is pending", async () => {
    const { container } = render(<MappingAutoResolver pending={0} />);
    await Promise.resolve();
    expect(resolveMissing).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("runs once (also under StrictMode and re-renders), shows progress, then refreshes", async () => {
    let finish: (value: Awaited<ReturnType<typeof resolveMissingMappingsAction>>) => void = () => {};
    resolveMissing.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { rerender } = render(
      <StrictMode>
        <MappingAutoResolver pending={2} />
      </StrictMode>,
    );
    expect(screen.getByRole("status").textContent).toContain("Kursquellen werden ermittelt …");
    rerender(
      <StrictMode>
        <MappingAutoResolver pending={1} />
      </StrictMode>,
    );
    finish({ ok: true, mapped: 2, notFound: 0, failed: [] });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(resolveMissing).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names failed Securities and retries on 'Erneut versuchen'", async () => {
    resolveMissing
      .mockResolvedValueOnce({
        ok: true,
        mapped: 1,
        notFound: 0,
        failed: [
          { securityId: "a", name: "SAP" },
          { securityId: "b", name: "Bitcoin" },
        ],
      })
      .mockResolvedValueOnce({ ok: true, mapped: 2, notFound: 0, failed: [] });
    const user = userEvent.setup({ delay: null });
    render(<MappingAutoResolver pending={3} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Für 2 Wertpapiere konnte die Kursquelle gerade nicht ermittelt werden: SAP, Bitcoin.");
    expect(refresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(resolveMissing).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shows the session message without a retry and does not refresh when unauthorized", async () => {
    resolveMissing.mockResolvedValue({ ok: false, reason: "unauthorized" });
    render(<MappingAutoResolver pending={1} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a connection failure when the action is rejected", async () => {
    resolveMissing.mockRejectedValue(new Error("network"));
    render(<MappingAutoResolver pending={1} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Verbindung fehlgeschlagen.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
