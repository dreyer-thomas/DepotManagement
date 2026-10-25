import { describe, expect, it } from "vitest";
import { parseSemicolonCsv } from "./csv";

describe("parseSemicolonCsv", () => {
  it("splits on semicolons and numbers records from the header (= 1)", () => {
    expect(parseSemicolonCsv("a;b\n1;2\n3;4")).toEqual([
      { recordNumber: 1, fields: ["a", "b"] },
      { recordNumber: 2, fields: ["1", "2"] },
      { recordNumber: 3, fields: ["3", "4"] },
    ]);
  });

  it("strips a UTF-8 BOM and handles CRLF and a trailing newline", () => {
    expect(parseSemicolonCsv("﻿a;b\r\n1;2\r\n")).toEqual([
      { recordNumber: 1, fields: ["a", "b"] },
      { recordNumber: 2, fields: ["1", "2"] },
    ]);
  });

  it("reads quoted fields with escaped quotes, semicolons and line breaks", () => {
    expect(parseSemicolonCsv('x;y\n"Apfel ""Tech""; Inc.";"zwei\r\nZeilen"\n1;2')).toEqual([
      { recordNumber: 1, fields: ["x", "y"] },
      { recordNumber: 2, fields: ['Apfel "Tech"; Inc.', "zwei\r\nZeilen"] },
      { recordNumber: 3, fields: ["1", "2"] },
    ]);
  });

  it("keeps empty fields and skips blank lines without renumbering", () => {
    expect(parseSemicolonCsv('a;b;c\n;;\n\n"";x;')).toEqual([
      { recordNumber: 1, fields: ["a", "b", "c"] },
      { recordNumber: 2, fields: ["", "", ""] },
      { recordNumber: 4, fields: ["", "x", ""] },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseSemicolonCsv("")).toEqual([]);
    expect(parseSemicolonCsv("﻿\r\n")).toEqual([]);
  });
});
