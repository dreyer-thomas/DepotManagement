// PDF text extraction with unpdf (AD stack). Only the text is passed on; documents are never logged.

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when `bytes` start with the `%PDF-` header. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= PDF_HEADER.length && PDF_HEADER.every((byte, index) => bytes[index] === byte);
}

/** Extracts the text of all pages, merged into one string. Throws when the PDF cannot be read. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Loaded on first use so pages that only count batches never load pdf.js.
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js may take ownership of the buffer; it gets a copy. Verbosity 0 keeps its warnings out of the log.
  const document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    const { text } = await extractText(document, { mergePages: true });
    return text;
  } finally {
    // Frees the worker-side document; extraction never depends on it succeeding.
    await document.loadingTask.destroy().catch(() => undefined);
  }
}
