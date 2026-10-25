/**
 * Semicolon-delimited CSV tokenizer (Parqet exports). Pure: text in, records out.
 *
 * Handles an optional UTF-8 BOM, CRLF and LF line endings, quoted fields with `""` escapes, and `;`
 * or line breaks inside quotes. Every record gets its 1-based record number (the header is record 1);
 * blank lines count as records but are not returned, so record numbers match line numbers as long as no
 * quoted field spans lines.
 */

export type CsvRecord = { recordNumber: number; fields: string[] };

const DELIMITER = ";";
const QUOTE = '"';

export function parseSemicolonCsv(text: string): CsvRecord[] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordNumber = 1;
  // True once the current record has any content (a character, a delimiter or a quote).
  let started = false;

  const endRecord = () => {
    fields.push(field);
    if (started) records.push({ recordNumber, fields });
    recordNumber += 1;
    fields = [];
    field = "";
    started = false;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === QUOTE) {
        if (source[i + 1] === QUOTE) {
          field += QUOTE;
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === QUOTE) {
      inQuotes = true;
      started = true;
    } else if (char === DELIMITER) {
      fields.push(field);
      field = "";
      started = true;
    } else if (char === "\r" && source[i + 1] === "\n") {
      endRecord();
      i += 1;
    } else if (char === "\n" || char === "\r") {
      endRecord();
    } else {
      field += char;
      started = true;
    }
  }
  if (started || field !== "" || fields.length > 0) endRecord();
  return records;
}
