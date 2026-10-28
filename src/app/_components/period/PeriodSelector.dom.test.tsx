// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { setPeriodAction } from "@/app/_actions/period";
import { customRangeError, PeriodSelector } from "./PeriodSelector";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/_actions/period", () => ({ setPeriodAction: vi.fn() }));

registerDomCleanup();

const action = vi.mocked(setPeriodAction);
const TODAY = "2026-10-26";

beforeEach(() => {
  action.mockReset();
  refresh.mockReset();
});

const pill = (name: string) => within(screen.getByRole("group", { name: "Zeitraum" })).getByRole("button", { name });

describe("PeriodSelector", () => {
  it("marks the stored Period and offers every preset plus Benutzerdefiniert", () => {
    render(<PeriodSelector period={{ kind: "preset", preset: "3J" }} today={TODAY} />);
    const names = within(screen.getByRole("group", { name: "Zeitraum" }))
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["1T", "1W", "1M", "YTD", "1J", "3J", "Max", "Benutzerdefiniert"]);
    expect(pill("3J").getAttribute("aria-pressed")).toBe("true");
    expect(pill("1J").getAttribute("aria-pressed")).toBe("false");
  });

  it("stores a clicked preset and refreshes the page", async () => {
    action.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("YTD"));
    expect(action).toHaveBeenCalledWith("YTD");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("does nothing when the selected preset is clicked again", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("1J"));
    expect(action).not.toHaveBeenCalled();
  });

  it("shows the session message without refreshing when unauthorized", async () => {
    action.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("1M"));
    expect((await screen.findByRole("alert")).textContent).toContain("Sitzung abgelaufen. Bitte erneut anmelden.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves a custom range from the dialog", async () => {
    action.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("Benutzerdefiniert"));
    const dialog = await screen.findByRole("dialog", { name: "Zeitraum wählen" });
    fireEvent.change(within(dialog).getByLabelText(/Von/), { target: { value: "2026-01-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Bis/), { target: { value: "2026-06-30" } });
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(action).toHaveBeenCalledWith("custom:2026-01-01:2026-06-30");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks an invalid range with a message and saves nothing", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "custom", from: "2026-01-01", to: "2026-06-30" }} today={TODAY} />);
    expect(pill("Benutzerdefiniert").getAttribute("aria-pressed")).toBe("true");
    await user.click(pill("Benutzerdefiniert"));
    const dialog = await screen.findByRole("dialog", { name: "Zeitraum wählen" });
    expect((within(dialog).getByLabelText(/Von/) as HTMLInputElement).value).toBe("2026-01-01");
    fireEvent.change(within(dialog).getByLabelText(/Von/), { target: { value: "2026-07-01" } });
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(within(dialog).getByRole("alert").textContent).toContain("Von darf nicht nach Bis liegen.");
    expect(action).not.toHaveBeenCalled();
  });
});

describe("PeriodSelector failures", () => {
  it("keeps the dialog open with the message when the custom save is refused", async () => {
    action.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("Benutzerdefiniert"));
    const dialog = await screen.findByRole("dialog", { name: "Zeitraum wählen" });
    fireEvent.change(within(dialog).getByLabelText(/Von/), { target: { value: "2026-01-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Bis/), { target: { value: "2026-06-30" } });
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Sitzung abgelaufen. Bitte erneut anmelden.");
    expect(screen.getByRole("dialog", { name: "Zeitraum wählen" })).toBe(dialog);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the connection message when a preset save is rejected", async () => {
    action.mockRejectedValue(new Error("network"));
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("1M"));
    expect((await screen.findByRole("alert")).textContent).toContain("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(pill("1J").getAttribute("aria-pressed")).toBe("true"));
  });

  it("disables Abbrechen while a custom save is running", async () => {
    action.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("Benutzerdefiniert"));
    const dialog = await screen.findByRole("dialog", { name: "Zeitraum wählen" });
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect((within(dialog).getByRole("button", { name: "Abbrechen" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Zeitraum wählen" })).toBe(dialog);
  });

  it("keeps the clicked preset selected and locks the pills while its save is running", async () => {
    action.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ delay: null });
    render(<PeriodSelector period={{ kind: "preset", preset: "1J" }} today={TODAY} />);
    await user.click(pill("1M"));
    expect(pill("1M").getAttribute("aria-pressed")).toBe("true");
    expect((pill("YTD") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pill("YTD"));
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("customRangeError", () => {
  it("accepts from ≤ to ≤ today and names each violation", () => {
    expect(customRangeError("2026-01-01", "2026-06-30", TODAY)).toBeNull();
    expect(customRangeError(TODAY, TODAY, TODAY)).toBeNull();
    expect(customRangeError("", "2026-06-30", TODAY)).toBe("Bitte gültige Daten für Von und Bis eingeben.");
    expect(customRangeError("2026-07-01", "2026-06-30", TODAY)).toBe("Von darf nicht nach Bis liegen.");
    expect(customRangeError("2026-01-01", "2026-10-27", TODAY)).toBe("Bis darf nicht nach heute liegen.");
  });
});
