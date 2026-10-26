import { describe, expect, it } from "vitest";
import { minimalPdf } from "../../../test/helpers/pdf";
import { extractPdfText, isPdf } from "./extract";

describe("isPdf", () => {
  it("accepts bytes starting with %PDF-", () => {
    expect(isPdf(minimalPdf("x"))).toBe(true);
  });

  it.each([
    ["empty bytes", new Uint8Array(0)],
    ["a text file", new TextEncoder().encode("Kauf 10 Stück")],
    ["a header not at the start", new TextEncoder().encode(" %PDF-1.4")],
    ["a truncated header", new TextEncoder().encode("%PDF")],
  ])("rejects %s", (_label, bytes) => {
    expect(isPdf(bytes)).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("extracts the text of a PDF with unpdf", async () => {
    expect(await extractPdfText(minimalPdf("Wertpapierabrechnung Kauf (Beispiel)"))).toBe("Wertpapierabrechnung Kauf (Beispiel)");
  });

  it("leaves the caller's bytes usable", async () => {
    const bytes = minimalPdf("Beispiel");
    await extractPdfText(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(isPdf(bytes)).toBe(true);
  });

  it("throws for bytes that only look like a PDF", async () => {
    await expect(extractPdfText(new TextEncoder().encode("%PDF-1.4 kaputt"))).rejects.toThrow();
  });
});
