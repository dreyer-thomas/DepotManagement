import { describe, expect, it } from "vitest";
import { batchSummary, discardErrorMessage, fileCountLabel, formatMegabytes, itemCounts, uploadErrorMessage } from "./labels";

describe("import labels", () => {
  it("summarises a batch", () => {
    expect(batchSummary({ fileCount: 3, parsedCount: 1, failedCount: 2 })).toBe("3 Dateien · 1 erkannt · 2 fehlgeschlagen");
    expect(batchSummary(itemCounts([{ status: "FAILED" }]))).toBe("1 Datei · 0 erkannt · 1 fehlgeschlagen");
    expect(fileCountLabel(0)).toBe("0 Dateien");
  });

  it("has a German message for every failure", () => {
    expect(uploadErrorMessage("depot-archived")).toBe("Depot ist archiviert. Bitte zuerst reaktivieren.");
    expect(uploadErrorMessage("files-missing")).toBe("Bitte mindestens eine PDF-Datei auswählen.");
    expect(discardErrorMessage("not-found")).toBe("Import nicht gefunden.");
  });

  it("formats megabytes in German", () => {
    expect(formatMegabytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(formatMegabytes(120 * 1024)).toBe("0,1 MB");
    expect(formatMegabytes(30 * 1024)).toBe("< 0,1 MB");
  });
});
