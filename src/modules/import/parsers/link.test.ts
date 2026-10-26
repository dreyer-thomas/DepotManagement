import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { linkDocuments } from "./link";
import { parseDocument, UNRECOGNIZED_REASON } from "./registry";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../test/fixtures/import/comdirect", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";
const file = (fileName: string, text: string) => ({ fileName, outcome: parseDocument("COMDIRECT", text) });
const credit = (name = "dividend.pdf", text = fixture("dividend.txt")) => file(name, text);
const notice = (name = "steuer.pdf", text = fixture("dividend-tax.txt")) => file(name, text);

describe("linkDocuments", () => {
  it("merges a Steuermitteilung into its Ertragsgutschrift: tax = gross − nach Steuern, notice needs no booking", () => {
    expect(linkDocuments([credit(), notice()])).toEqual([
      {
        status: "PARSED",
        documentType: "dividend",
        proposals: [
          {
            type: "DIVIDEND",
            date: "2026-06-21",
            isin: "IE00B3RBWM25",
            name: "Vanguard FTSE All-World UCITS ETF",
            amount: "25.57",
            fee: "0",
            tax: "4.73",
          },
        ],
      },
      { status: "NO_BOOKING", documentType: "dividend-tax", reason: "Steuern in „dividend.pdf“ übernommen. Keine Buchung erforderlich." },
    ]);
  });

  it("merges regardless of file order", () => {
    const [first, second] = linkDocuments([notice(), credit()]);
    expect(first).toMatchObject({ status: "NO_BOOKING" });
    expect(second).toMatchObject({ status: "PARSED", proposals: [{ tax: "4.73" }] });
  });

  it("keeps a lone credit with its note (tax 0)", () => {
    expect(linkDocuments([credit()])).toEqual([
      {
        status: "PARSED",
        documentType: "dividend",
        proposals: [expect.objectContaining({ type: "DIVIDEND", amount: "25.57", tax: "0" })],
        note: "Steuermitteilung (Referenz-Nr. 3AAAAAAAAAA001AA) nicht im Import: Steuern sind nicht enthalten. Bitte prüfen oder zusammen hochladen.",
      },
    ]);
  });

  it("fails a lone notice", () => {
    expect(linkDocuments([notice()])).toEqual([{ status: "FAILED", reason: "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen." }]);
  });

  it("does not merge a notice of another reference", () => {
    const other = fixture("dividend-tax.txt").replace("3AAAAAAAAAA001AA", "3AAAAAAAAAA009AA");
    const [first, second] = linkDocuments([credit(), notice("other.pdf", other)]);
    expect(first).toMatchObject({ status: "PARSED", proposals: [{ tax: "0" }], note: expect.any(String) });
    expect(second).toEqual({ status: "FAILED", reason: "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen." });
  });

  it.each([
    ["ISIN", (text: string) => text.replace("A1JX52 / IE00B3RBWM25", "A1JX52 / DE0005933931")],
    [
      "vor Steuern",
      (text: string) =>
        text.replace("vor Steuern: EUR 25,57", "vor Steuern: EUR 25,00").replace("nach Steuern: EUR 20,84", "nach Steuern: EUR 20,27"),
    ],
  ])("fails credit and notice when the notice's %s differs", (_label, change) => {
    const reason = `Steuermitteilung passt nicht zur Ertragsgutschrift (Referenz-Nr. 3AAAAAAAAAA001AA). ${MANUAL}`;
    expect(linkDocuments([credit(), notice("steuer.pdf", change(fixture("dividend-tax.txt")))])).toEqual([
      { status: "FAILED", reason },
      { status: "FAILED", reason },
    ]);
  });

  it("merges one notice into two credits of the same reference", () => {
    const result = linkDocuments([credit("a.pdf"), credit("b.pdf"), notice()]);
    expect(result[0]).toMatchObject({ status: "PARSED", proposals: [{ tax: "4.73" }] });
    expect(result[1]).toMatchObject({ status: "PARSED", proposals: [{ tax: "4.73" }] });
    expect(result[0]).not.toHaveProperty("note");
    expect(result[2]).toEqual({
      status: "NO_BOOKING",
      documentType: "dividend-tax",
      reason: "Steuern in „a.pdf“, „b.pdf“ übernommen. Keine Buchung erforderlich.",
    });
  });

  it("fails credit and both notices when two notices of one reference disagree", () => {
    const other = fixture("dividend-tax.txt")
      .replace("abgeführte Steuern EUR -4,73", "abgeführte Steuern EUR -4,48")
      .replace("nach Steuern: EUR 20,84", "nach Steuern: EUR 21,09");
    const reason = `Steuermitteilung passt nicht zur Ertragsgutschrift (Referenz-Nr. 3AAAAAAAAAA001AA). ${MANUAL}`;
    expect(linkDocuments([credit(), notice(), notice("steuer-2.pdf", other)])).toEqual([
      { status: "FAILED", reason },
      { status: "FAILED", reason },
      { status: "FAILED", reason },
    ]);
  });

  it("merges two identical notices of one reference into the credit", () => {
    const result = linkDocuments([credit(), notice(), notice("steuer-2.pdf")]);
    expect(result[0]).toMatchObject({ status: "PARSED", proposals: [{ tax: "4.73" }] });
    expect(result[1]).toMatchObject({ status: "NO_BOOKING" });
    expect(result[2]).toMatchObject({ status: "NO_BOOKING" });
  });

  it("merges a credit with foreign withholding: tax = gross − nach Steuern", () => {
    const withheld = fixture("dividend.txt").replace("EUR 23.06.2026 EUR 25,57", "EUR 23.06.2026 EUR 21,74");
    const taxNotice = fixture("dividend-tax.txt")
      .replace("vor Steuern: EUR 25,57", "vor Steuern: EUR 21,74")
      .replace("nach Steuern: EUR 20,84", "nach Steuern: EUR 17,01");
    const result = linkDocuments([credit("dividend.pdf", withheld), notice("steuer.pdf", taxNotice)]);
    expect(result[0]).toMatchObject({ status: "PARSED", proposals: [{ amount: "25.57", tax: "8.56" }] });
    expect(result[1]).toMatchObject({ status: "NO_BOOKING" });
  });

  it("passes a NO_BOOKING outcome through unchanged", () => {
    const noBooking = { status: "NO_BOOKING", documentType: "tax-pot", reason: "Keine Buchung erforderlich." } as const;
    expect(linkDocuments([credit(), { fileName: "topf.pdf", outcome: noBooking }])).toEqual([
      expect.objectContaining({ status: "PARSED", documentType: "dividend" }),
      noBooking,
    ]);
  });

  it("passes other outcomes through without links", () => {
    const result = linkDocuments([file("buy.pdf", fixture("buy.txt")), file("x.pdf", "Kontoauszug")]);
    expect(result[0]).toMatchObject({ status: "PARSED", documentType: "trade" });
    expect(result[0]).not.toHaveProperty("link");
    expect(result[1]).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
  });
});
