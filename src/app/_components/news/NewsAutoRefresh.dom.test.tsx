// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { refreshNewsAction, type RefreshNewsActionResult } from "@/app/_actions/news";
import { NewsAutoRefresh } from "./NewsAutoRefresh";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/_actions/news", () => ({ refreshNewsAction: vi.fn() }));

registerDomCleanup();

const refreshNews = vi.mocked(refreshNewsAction);

beforeEach(() => {
  refreshNews.mockReset();
  refresh.mockReset();
});

describe("NewsAutoRefresh", () => {
  it("runs once after mount (also under StrictMode and re-renders), shows progress, then refreshes the page", async () => {
    let finish: (value: RefreshNewsActionResult) => void = () => {};
    refreshNews.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { rerender } = render(
      <StrictMode>
        <NewsAutoRefresh />
      </StrictMode>,
    );
    expect(screen.getByRole("status").textContent).toContain("Nachrichten werden aktualisiert …");
    rerender(
      <StrictMode>
        <NewsAutoRefresh />
      </StrictMode>,
    );
    finish({ ok: true, updated: 2, failed: [] });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(refreshNews).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("counts partially failed Securities and retries on 'Erneut versuchen'", async () => {
    refreshNews
      .mockResolvedValueOnce({
        ok: true,
        updated: 1,
        failed: [
          { securityId: "a", name: "SAP SE" },
          { securityId: "b", name: "Siemens AG" },
        ],
      })
      .mockResolvedValueOnce({ ok: true, updated: 2, failed: [] });
    const user = userEvent.setup({ delay: null });
    render(<NewsAutoRefresh />);
    expect((await screen.findByRole("alert")).textContent).toContain("Nachrichten für 2 Wertpapiere konnten nicht geladen werden.");
    expect(refresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(refreshNews).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shows the failure text with a retry when the action is rejected", async () => {
    refreshNews.mockRejectedValue(new Error("network"));
    render(<NewsAutoRefresh />);
    expect((await screen.findByRole("alert")).textContent).toContain("Nachrichten konnten nicht aktualisiert werden.");
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeDefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the session message without a retry when unauthorized", async () => {
    refreshNews.mockResolvedValue({ ok: false, reason: "unauthorized" });
    render(<NewsAutoRefresh />);
    expect((await screen.findByRole("alert")).textContent).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
