// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseFile, formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { createTestDatabase, type TestDatabase } from "../../../../test/helpers/test-db";
import {
  confirmParqetAction,
  type ConfirmParqetActionResult,
  openingBalanceAction,
  type OpeningBalanceActionResult,
  previewParqetAction,
  type PreviewParqetActionState,
} from "@/app/_actions/migration";
import { createDepot } from "@/modules/ledger";
import { confirmParqetMigration, type MigrationSummary, type ParqetPreview, previewParqetMigration } from "@/modules/migration";
import { initialDecisions, submittedDecisions } from "@/modules/migration/decisions";
import { ACTION_FAILED_MESSAGE } from "./labels";
import { ParqetMigrationWizard } from "./ParqetMigrationWizard";

vi.mock("@/app/_actions/migration", () => ({
  previewParqetAction: vi.fn(),
  confirmParqetAction: vi.fn(),
  openingBalanceAction: vi.fn(),
}));

registerDomCleanup();

const previewAction = vi.mocked(previewParqetAction);
const confirmAction = vi.mocked(confirmParqetAction);
const openingAction = vi.mocked(openingBalanceAction);

const fixture = (name: string) => readFileSync(resolve(__dirname, `../../../../test/fixtures/parqet/${name}`), "utf8");
const FIXTURE = fixture("synthetic-export.csv.txt");
const NO_CASH = fixture("synthetic-export-no-cash.csv.txt");

let testDb: TestDatabase;
/** Fresh preview of the synthetic export: estimated types, flagged rows, no duplicates. */
let preview: ParqetPreview;
/** The same file after it was booked: possible duplicates of the ledger. */
let rerun: ParqetPreview;
let summary: MigrationSummary;
/** Summary of a file without Cash rows: offers the opening booking. */
let noCashSummary: MigrationSummary;

beforeAll(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  const other = await createDepot({ name: "Zweitdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  if (!depot.ok || !other.ok) throw new Error("setup failed");
  const fresh = await previewParqetMigration(depot.depot.id, FIXTURE, testDb.client);
  if (!fresh.ok) throw new Error(fresh.reason);
  preview = fresh.preview;
  const booked = await confirmParqetMigration(depot.depot.id, FIXTURE, { classifications: {}, flags: {}, duplicates: {} }, testDb.client);
  if (!booked.ok) throw new Error(booked.reason);
  summary = booked.summary;
  const again = await previewParqetMigration(depot.depot.id, FIXTURE, testDb.client);
  if (!again.ok) throw new Error(again.reason);
  rerun = again.preview;
  const noCash = await confirmParqetMigration(
    other.depot.id,
    NO_CASH,
    { classifications: { IE00B4L5Y983: "ETF" }, flags: {}, duplicates: {} },
    testDb.client,
  );
  if (!noCash.ok) throw new Error(noCash.reason);
  noCashSummary = noCash.summary;
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(() => {
  previewAction.mockReset();
  confirmAction.mockReset();
  openingAction.mockReset();
});

const depots = [
  { id: "d1", name: "Hauptdepot" },
  { id: "d2", name: "Zweitdepot" },
];

const csv = (name = "export.csv") => new File([FIXTURE], name, { type: "text/csv" });
const previewTitle = () => `Vorschau – ${preview.depot.name}, Stand 04.07.2024`;

function deferred<T>() {
  let resolveIt!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolveIt = res;
  });
  return { promise, resolve: resolveIt };
}

function renderWizard() {
  const user = userEvent.setup({ delay: null });
  const { container } = render(<ParqetMigrationWizard depots={depots} />);
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  return { user, fileInput };
}

/** Picks `file`, submits the preview with the default Depot and waits for the preview to show. */
async function loadPreview(file = csv()) {
  previewAction.mockResolvedValue({ ok: true, preview });
  const wizard = renderWizard();
  chooseFile(wizard.fileInput, file);
  await wizard.user.click(screen.getByRole("button", { name: "Vorschau anzeigen" }));
  await screen.findByRole("heading", { name: previewTitle() });
  // The transition ends after the preview renders; until then the inputs are disabled.
  await screen.findByRole("button", { name: "Übernehmen" });
  return wizard;
}

describe("ParqetMigrationWizard preview", () => {
  it("shows the pending label while reading, then the preview, sending file and Depot", async () => {
    const pending = deferred<PreviewParqetActionState>();
    previewAction.mockReturnValue(pending.promise);
    const { user, fileInput } = renderWizard();
    const file = csv();
    chooseFile(fileInput, file);
    expect(screen.getByText("export.csv")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Vorschau anzeigen" }));

    expect(await screen.findByRole("button", { name: "Wird gelesen …" })).toBeTruthy();
    expect(previewAction).toHaveBeenCalledTimes(1);
    const sent = formEntries(previewAction.mock.calls[0][1]);
    expect(sent.depotId).toBe("d1");
    expect((sent.file as File).name).toBe("export.csv");

    pending.resolve({ ok: true, preview });
    expect(await screen.findByRole("heading", { name: previewTitle() })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vorschau anzeigen" })).toBeTruthy();
    expect(screen.getByText("Es wurde noch nichts gebucht.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Offene Entscheidungen: 0");
  });

  it("shows a failed preview in an Alert", async () => {
    previewAction.mockResolvedValue({ ok: false, reason: "missing-columns", columns: ["shares", "price"] });
    const { user, fileInput } = renderWizard();
    chooseFile(fileInput, csv());
    await user.click(screen.getByRole("button", { name: "Vorschau anzeigen" }));
    expect(await screen.findByText("Das ist kein Parqet-Export: Es fehlen die Spalten shares, price.")).toBeTruthy();
    expect(screen.queryByText("Es wurde noch nichts gebucht.")).toBeNull();
  });

  it("shows the connection message when the action throws", async () => {
    previewAction.mockRejectedValue(new Error("network"));
    const { user, fileInput } = renderWizard();
    chooseFile(fileInput, csv());
    await user.click(screen.getByRole("button", { name: "Vorschau anzeigen" }));
    expect(await screen.findByText(ACTION_FAILED_MESSAGE)).toBeTruthy();
  });
});

describe("ParqetMigrationWizard confirm", () => {
  it("re-sends the same file, Depot and decisions (incl. a changed type) and shows the summary", async () => {
    confirmAction.mockResolvedValue({ ok: true, summary });
    const file = csv();
    const { user } = await loadPreview(file);
    await user.selectOptions(screen.getByRole("combobox", { name: "Art von Welt ETF" }), "FUND");
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    expect(await screen.findByText(`Übernommen – ${summary.depot.name}`)).toBeTruthy();
    expect(confirmAction).toHaveBeenCalledTimes(1);
    const sent = formEntries(confirmAction.mock.calls[0][0]);
    expect(sent.file).toBe(file);
    expect(sent.depotId).toBe("d1");
    expect(JSON.parse(sent.decisions as string)).toEqual({
      classifications: { IE00B4L5Y983: "FUND" },
      flags: {},
      duplicates: {},
    });
    expect(screen.queryByRole("heading", { name: previewTitle() })).toBeNull();
  });

  it("after decisions-open shows the new preview, carries the decisions and explains why", async () => {
    expect(rerun.duplicates.length).toBeGreaterThan(0);
    // The file changed since the preview: now with duplicates, the classifiable Securities unchanged.
    const changed: ParqetPreview = { ...preview, duplicates: rerun.duplicates };
    confirmAction
      .mockResolvedValueOnce({ ok: false, reason: "decisions-open", preview: changed, open: [] } as ConfirmParqetActionResult)
      .mockResolvedValueOnce({ ok: true, summary });
    const file = csv();
    const { user } = await loadPreview(file);
    await user.selectOptions(screen.getByRole("combobox", { name: "Art von Welt ETF" }), "FUND");
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    expect(await screen.findByText(/^Seit der Vorschau hat sich etwas geändert/)).toBeTruthy();
    expect(screen.getByText("Mögliche Doppelbuchungen")).toBeTruthy();
    expect(screen.queryByText("Keine Doppelbuchungen im Depot gefunden.")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Art von Welt ETF" }) as HTMLSelectElement).value).toBe("FUND");
    expect(screen.getByRole("status").textContent).toBe("Offene Entscheidungen: 0");

    await user.click(await screen.findByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(2));
    const sent = formEntries(confirmAction.mock.calls[1][0]);
    expect(sent.file).toBe(file);
    expect(sent.depotId).toBe("d1");
    expect(JSON.parse(sent.decisions as string)).toEqual({
      classifications: { IE00B4L5Y983: "FUND" },
      flags: {},
      duplicates: Object.fromEntries(rerun.duplicates.map((duplicate) => [duplicate.key, "skip"])),
    });
    expect(await screen.findByText(`Übernommen – ${summary.depot.name}`)).toBeTruthy();
  });

  it("'Alle wie in Parqet übernehmen' sends the as-is decisions for the flagged rows", async () => {
    confirmAction.mockResolvedValue({ ok: true, summary });
    const file = csv();
    const { user } = await loadPreview(file);
    await user.click(screen.getByRole("button", { name: `Nicht übernommen (${preview.flagged.length})` }));
    await user.click(await screen.findByRole("button", { name: "Alle wie in Parqet übernehmen" }));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    const sent = formEntries(confirmAction.mock.calls[0][0]);
    expect(sent.file).toBe(file);
    expect(sent.depotId).toBe("d1");
    const decisions = JSON.parse(sent.decisions as string);
    expect(decisions).toEqual(submittedDecisions(preview, initialDecisions(preview), true));
    expect(Object.keys(decisions.flags).length).toBeGreaterThan(0);
  });

  it("shows a thrown confirm as the connection message and keeps the preview", async () => {
    confirmAction.mockRejectedValue(new Error("network"));
    const { user } = await loadPreview();
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByText(ACTION_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("heading", { name: previewTitle() })).toBeTruthy();
  });
});

describe("ParqetMigrationWizard reset", () => {
  it("clears the preview when another file is chosen", async () => {
    const { fileInput } = await loadPreview();
    chooseFile(fileInput, csv("other.csv"));
    expect(screen.queryByRole("heading", { name: previewTitle() })).toBeNull();
    expect(screen.getByText("other.csv")).toBeTruthy();
  });

  it("clears the preview when another Depot is chosen", async () => {
    const { user } = await loadPreview();
    await user.selectOptions(screen.getByRole("combobox", { name: "Ziel-Depot" }), "d2");
    expect(screen.queryByRole("heading", { name: previewTitle() })).toBeNull();
    expect(screen.queryByRole("button", { name: "Übernehmen" })).toBeNull();
  });

  it("clears an error when the Depot changes and the summary when the file changes", async () => {
    previewAction.mockResolvedValueOnce({ ok: false, reason: "depot-archived" });
    const { user, fileInput } = renderWizard();
    chooseFile(fileInput, csv());
    await user.click(screen.getByRole("button", { name: "Vorschau anzeigen" }));
    const archived = "Depot ist archiviert. Bitte zuerst reaktivieren.";
    expect(await screen.findByText(archived)).toBeTruthy();
    await screen.findByRole("button", { name: "Vorschau anzeigen" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Ziel-Depot" }), "d2");
    expect(screen.queryByText(archived)).toBeNull();

    previewAction.mockResolvedValueOnce({ ok: true, preview });
    confirmAction.mockResolvedValueOnce({ ok: true, summary });
    await user.click(screen.getByRole("button", { name: "Vorschau anzeigen" }));
    await user.click(await screen.findByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByText(`Übernommen – ${summary.depot.name}`)).toBeTruthy();
    expect(formEntries(confirmAction.mock.calls[0][0]).depotId).toBe("d2");
    chooseFile(fileInput, csv("next.csv"));
    expect(screen.queryByText(`Übernommen – ${summary.depot.name}`)).toBeNull();
  });
});

describe("OpeningBalanceForm in the summary", () => {
  it("sends Depot, date, export date and balance and disables the inputs after booking", async () => {
    const offer = noCashSummary.openingBalance!;
    confirmAction.mockResolvedValue({ ok: true, summary: noCashSummary });
    openingAction.mockResolvedValue({
      ok: true,
      transaction: { type: "DEPOSIT", amount: "200", date: offer.date },
      balance: "500",
    } as OpeningBalanceActionResult);
    const { user } = await loadPreview();
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    const form = await screen.findByRole("form", { name: "Eröffnungsbuchung" });
    const balance = within(form).getByRole("textbox", { name: "Saldo laut Broker am 02.05.2024" }) as HTMLInputElement;
    await user.type(balance, "500,00");
    await user.click(within(form).getByRole("button", { name: "Eröffnungsbuchung buchen" }));

    expect((await within(form).findByRole("status")).textContent).toBe(
      "Einzahlung über 200,00 € am 02.05.2024 gebucht. Saldo am 02.05.2024: 500,00 €.",
    );
    expect(formEntries(openingAction.mock.calls[0][0])).toEqual({
      depotId: noCashSummary.depot.id,
      date: offer.date,
      asOf: offer.asOf,
      balance: "500,00",
    });
    expect(balance.disabled).toBe(true);
    expect((form.querySelector('input[name="date"]') as HTMLInputElement).disabled).toBe(true);
    expect((await within(form).findByRole("button", { name: "Eröffnungsbuchung buchen" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
