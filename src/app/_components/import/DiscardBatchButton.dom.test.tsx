// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { DiscardBatchButton } from "./DiscardBatchButton";

const discardImportBatchAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/_actions/import", () => ({ discardImportBatchAction }));

registerDomCleanup();

beforeEach(() => {
  discardImportBatchAction.mockReset();
});

describe("DiscardBatchButton", () => {
  it("asks for confirmation, then submits the batch id", async () => {
    discardImportBatchAction.mockResolvedValue(null);
    const user = userEvent.setup({ delay: null });
    render(<DiscardBatchButton batchId="b1" fileCount={3} />);
    await user.click(screen.getByRole("button", { name: "Verwerfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Import verwerfen?" });
    expect(within(dialog).getByText("3 Dateien und alle Vorschläge werden gelöscht. Gebucht wurde nichts.")).toBeTruthy();
    expect(discardImportBatchAction).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(discardImportBatchAction).toHaveBeenCalledTimes(1));
    expect(formEntries(discardImportBatchAction.mock.calls[0]![1] as FormData)).toEqual({ batchId: "b1" });
  });

  it("shows the connection message inside the dialog when the action throws", async () => {
    discardImportBatchAction.mockRejectedValue(new Error("disk full"));
    const user = userEvent.setup({ delay: null });
    render(<DiscardBatchButton batchId="b1" fileCount={1} />);
    await user.click(screen.getByRole("button", { name: "Verwerfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Import verwerfen?" });
    await user.click(within(dialog).getByRole("button", { name: "Verwerfen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("shows a failure inside the dialog", async () => {
    discardImportBatchAction.mockResolvedValue({ ok: false, reason: "not-found" });
    const user = userEvent.setup({ delay: null });
    render(<DiscardBatchButton batchId="b1" fileCount={1} />);
    await user.click(screen.getByRole("button", { name: "Verwerfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Import verwerfen?" });
    await user.click(within(dialog).getByRole("button", { name: "Verwerfen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Import nicht gefunden.");
  });
});
