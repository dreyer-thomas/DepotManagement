// @vitest-environment happy-dom
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { disconnectAllAppsAction, disconnectAppAction } from "@/app/_actions/connected-apps";
import type { ConnectedApp } from "@/modules/mcp";
import { ConnectedAppsList } from "./ConnectedAppsList";

vi.mock("@/app/_actions/connected-apps", () => ({
  disconnectAppAction: vi.fn(),
  disconnectAllAppsAction: vi.fn(),
}));

registerDomCleanup();

const disconnect = vi.mocked(disconnectAppAction);
const disconnectAll = vi.mocked(disconnectAllAppsAction);

const APPS: ConnectedApp[] = [
  {
    grantId: "g2",
    clientName: "Claude Code",
    redirectHosts: ["localhost:33418"],
    scopes: ["watchlist", "portfolio:read", "foo"],
    createdAt: "2026-10-25T08:00:00.000Z",
    lastUsedAt: null,
  },
  {
    grantId: "g1",
    clientName: "Claude",
    redirectHosts: ["claude.ai", "claude.com"],
    scopes: ["watchlist"],
    createdAt: "2026-10-20T08:00:00.000Z",
    lastUsedAt: "2026-10-28T09:30:00.000Z",
  },
];

beforeEach(() => {
  disconnect.mockReset();
  disconnectAll.mockReset();
});

describe("ConnectedAppsList", () => {
  it("shows each connection with hosts, German scopes and times", () => {
    render(<ConnectedAppsList apps={APPS} empty={<p>leer</p>} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("claude.ai, claude.com");
    expect(text).toContain("Watchlists lesen und ändern, Depotdaten lesen (nur lesen), foo");
    expect(text).toContain("Verbunden seit 20.10.2026, 10:00");
    expect(text).toContain("Zuletzt verwendet 28.10.2026, 10:30");
    expect(text).toContain("Zuletzt verwendet: noch nie");
    expect(text).not.toContain("leer");
    expect(screen.getByRole("button", { name: "Alle trennen" })).toBeDefined();
  });

  it("shows the empty state without the Alle trennen button", () => {
    render(<ConnectedAppsList apps={[]} empty={<p>leer</p>} />);
    expect(screen.getByText("leer")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Alle trennen" })).toBeNull();
  });

  it("confirms Trennen naming the client, with Abbrechen focused, and toasts on success", async () => {
    disconnect.mockResolvedValue({ ok: true, clientName: "Claude" });
    const user = userEvent.setup({ delay: null });
    render(<ConnectedAppsList apps={APPS} empty={null} />);
    await user.click(screen.getByRole("button", { name: "„Claude“ trennen" }));
    const dialog = await screen.findByRole("dialog", { name: "„Claude“ trennen?" });
    expect(dialog.textContent).toContain("verliert sofort den Zugriff");
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Abbrechen"));
    const confirm = screen.getByRole("button", { name: "Trennen" });
    expect(confirm.className).toContain("MuiButton-colorError");
    await user.click(confirm);
    await waitForElementToBeRemoved(dialog);
    expect(disconnect).toHaveBeenCalledWith("g1");
    expect((await screen.findByRole("status")).textContent).toContain("„Claude“ getrennt.");
  });

  it("shows a stale connection's message in the dialog", async () => {
    disconnect.mockResolvedValue({ ok: false, reason: "not-found" });
    const user = userEvent.setup({ delay: null });
    render(<ConnectedAppsList apps={APPS} empty={null} />);
    await user.click(screen.getByRole("button", { name: "„Claude Code“ trennen" }));
    await screen.findByRole("dialog", { name: "„Claude Code“ trennen?" });
    await user.click(screen.getByRole("button", { name: "Trennen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Diese Verbindung besteht nicht mehr.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["unauthorized", () => disconnect.mockResolvedValue({ ok: false, reason: "unauthorized" }), "Sitzung abgelaufen. Bitte erneut anmelden."],
    ["a thrown action", () => disconnect.mockRejectedValue(new Error("offline")), "Verbindung fehlgeschlagen. Bitte erneut versuchen."],
  ])("keeps the dialog open with an alert for %s and shows no toast", async (_case, arrange, message) => {
    arrange();
    const user = userEvent.setup({ delay: null });
    render(<ConnectedAppsList apps={APPS} empty={null} />);
    await user.click(screen.getByRole("button", { name: "„Claude“ trennen" }));
    await screen.findByRole("dialog", { name: "„Claude“ trennen?" });
    await user.click(screen.getByRole("button", { name: "Trennen" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole("dialog", { name: "„Claude“ trennen?" })).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does nothing on Abbrechen", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ConnectedAppsList apps={APPS} empty={null} />);
    await user.click(screen.getByRole("button", { name: "„Claude“ trennen" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitForElementToBeRemoved(dialog);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("confirms Alle trennen with the count and toasts", async () => {
    disconnectAll.mockResolvedValue({ ok: true, count: 2 });
    const user = userEvent.setup({ delay: null });
    render(<ConnectedAppsList apps={APPS} empty={null} />);
    await user.click(screen.getByRole("button", { name: "Alle trennen" }));
    const dialog = await screen.findByRole("dialog", { name: "Alle 2 verbundenen Apps trennen?" });
    await user.click(screen.getByRole("button", { name: "Trennen" }));
    await waitForElementToBeRemoved(dialog);
    expect(disconnectAll).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toContain("Alle Apps getrennt.");
  });

  it("keeps the toast when the list re-renders empty after Alle trennen", async () => {
    disconnectAll.mockResolvedValue({ ok: true, count: 2 });
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ConnectedAppsList apps={APPS} empty={<p>leer</p>} />);
    await user.click(screen.getByRole("button", { name: "Alle trennen" }));
    const dialog = await screen.findByRole("dialog", { name: "Alle 2 verbundenen Apps trennen?" });
    await user.click(screen.getByRole("button", { name: "Trennen" }));
    await waitForElementToBeRemoved(dialog);
    rerender(<ConnectedAppsList apps={[]} empty={<p>leer</p>} />);
    expect(screen.getByText("leer")).toBeDefined();
    expect((await screen.findByRole("status")).textContent).toContain("Alle Apps getrennt.");
  });
});
