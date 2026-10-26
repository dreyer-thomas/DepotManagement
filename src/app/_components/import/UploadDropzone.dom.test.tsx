// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseFile, formEntries, registerDomCleanup } from "../../../../test/helpers/dom";
import { UploadDropzone } from "./UploadDropzone";

const uploadDocumentsAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/_actions/import", () => ({ uploadDocumentsAction }));

registerDomCleanup();

const DEPOTS = [
  { id: "d1", name: "Hauptdepot" },
  { id: "d2", name: "ROBIN" },
];
const pdf = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  uploadDocumentsAction.mockReset();
});

function setup(defaultDepotId?: string) {
  const user = userEvent.setup({ delay: null });
  const view = render(<UploadDropzone depots={DEPOTS} defaultDepotId={defaultDepotId} />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { user, input, view };
}

describe("UploadDropzone", () => {
  it("offers a multi-PDF picker, the Depot select and touch-sized buttons", () => {
    const { input } = setup();
    expect(input.multiple).toBe(true);
    expect(input.getAttribute("accept")).toBe(".pdf,application/pdf");
    expect((screen.getByRole("combobox", { name: "Depot" }) as HTMLSelectElement).value).toBe("d1");
    expect(screen.getByText("Dateien auswählen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hochladen" })).toBeTruthy();
  });

  it("preselects the requested Depot and ignores an unknown one", () => {
    const { view } = setup("d2");
    expect((screen.getByRole("combobox", { name: "Depot" }) as HTMLSelectElement).value).toBe("d2");
    view.unmount();
    setup("archived-or-unknown");
    expect((screen.getByRole("combobox", { name: "Depot" }) as HTMLSelectElement).value).toBe("d1");
  });

  it("submits picked and dropped files in order with the chosen Depot", async () => {
    uploadDocumentsAction.mockResolvedValue(null);
    const { user, input } = setup("d2");
    chooseFile(input, pdf("a.pdf"));
    const dropped = new DataTransfer();
    dropped.items.add(pdf("b.pdf"));
    dropped.items.add(pdf("c.pdf"));
    fireEvent.drop(screen.getByTestId("import-dropzone"), { dataTransfer: dropped });
    expect(screen.getByText("3 Dateien ausgewählt (< 0,1 MB)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hochladen" }));
    await waitFor(() => expect(uploadDocumentsAction).toHaveBeenCalledTimes(1));
    const data = uploadDocumentsAction.mock.calls[0]![1] as FormData;
    expect(formEntries(data).depotId).toBe("d2");
    expect(data.getAll("files").map((file) => (file as File).name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("blocks an empty selection and one over 20 MB without calling the server", async () => {
    const { user, input } = setup();
    await user.click(screen.getByRole("button", { name: "Hochladen" }));
    expect(screen.getByRole("alert").textContent).toBe("Bitte mindestens eine PDF-Datei auswählen.");
    for (let i = 0; i < 5; i++) chooseFile(input, pdf(`${i}.pdf`, 4.5 * 1024 * 1024));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hochladen" }));
    expect(screen.getByRole("alert").textContent).toBe("Zusammen höchstens 20 MB. Bitte weniger Dateien auf einmal hochladen.");
    expect(uploadDocumentsAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Auswahl leeren" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/ausgewählt/)).toBeNull();
  });

  it("shows a server rejection as a German alert", async () => {
    uploadDocumentsAction.mockResolvedValue({ ok: false, reason: "depot-archived" });
    const { user, input } = setup();
    chooseFile(input, pdf("a.pdf"));
    await user.click(screen.getByRole("button", { name: "Hochladen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Depot ist archiviert. Bitte zuerst reaktivieren.");
  });

  it("shows the connection message when the action throws", async () => {
    uploadDocumentsAction.mockRejectedValue(new Error("database locked"));
    const { user, input } = setup();
    chooseFile(input, pdf("a.pdf"));
    await user.click(screen.getByRole("button", { name: "Hochladen" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("explains that a Depot is needed when there is none", () => {
    render(<UploadDropzone depots={[]} />);
    expect(screen.getByText("Kein aktives Depot vorhanden. Lege zuerst ein Depot an.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hochladen" })).toBeNull();
  });
});
