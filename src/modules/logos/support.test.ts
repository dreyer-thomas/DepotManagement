import { describe, expect, it } from "vitest";
import { isinSchema } from "@/modules/ledger";
import { sniffImage } from "./image";
import { CERTIFICATE_ISSUERS, issuerIsin } from "./issuers";
import { isLogoFileName, logosDir } from "./storage";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

describe("issuer table", () => {
  it.each(CERTIFICATE_ISSUERS.map((issuer) => [issuer.names[0], issuer.isin]))("%s has a valid ISIN", (_name, isin) => {
    expect(isinSchema.safeParse(isin).success).toBe(true);
  });

  it.each([
    ["Vontobel Turbo Long SAP", "CH0012335540"],
    ["HVB Bonus-Zertifikat (HypoVereinsbank)", "IT0005239360"],
    ["SOCIETE GENERALE Mini Future", "FR0000130809"],
    ["Société Générale Faktor", "FR0000130809"],
    ["J.P. Morgan Discount", "US46625H1005"],
    ["JPMorgan Express", "US46625H1005"],
    ["UBS Open End", "CH0244767585"],
    ["Xetra-Gold", "DE0005810055"],
    ["Deutsche  Bank X-markets", "DE0005140008"],
    ["HSBC Turbo Long Deutsche Bank", "GB0005405286"],
    ["Vontobel Mini Future UBS", "CH0012335540"],
    ["HVB Discount SAP", "IT0005239360"],
    ["Citi Turbo Short DAX", "US1729674242"],
    ["Goldman Mini Long Commerzbank", "US38141G1040"],
  ])("recognises %s", (name, isin) => {
    expect(issuerIsin(name)).toBe(isin);
  });

  it.each(["Turbo Long Allianz", "Subscribers Fund", "Hsbcx Note", "Vontobelli", "Citizen Fund", "HVBX Note"])("ignores %s (word-bounded)", (name) => {
    expect(issuerIsin(name)).toBeNull();
  });
});

describe("sniffImage", () => {
  it("recognises PNG, JPEG and WebP by magic bytes only", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.contentType).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))?.extension).toBe("jpg");
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.extension).toBe("webp");
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg/>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("storage", () => {
  it.each(["c1abc-123.png", "c1abc-123.jpg", "c1_abc-123.webp"])("accepts %s", (name) => {
    expect(isLogoFileName(name)).toBe(true);
  });

  it.each(["../x.png", "..%2Fx.png", "a/b.png", "a\\b.png", "x.svg", "x.png.html", ".png", "x.PNG", "x.png\n", ""])(
    "rejects %j",
    (name) => {
      expect(isLogoFileName(name)).toBe(false);
    },
  );

  it("uses DATA_DIR, else ~/.depotmanagement/data", () => {
    expect(logosDir({ DATA_DIR: "/srv/depot" })).toBe(join("/srv/depot", "logos"));
    expect(logosDir({ DATA_DIR: "relative" })).toBe(join(resolve("relative"), "logos"));
    expect(logosDir({ DATA_DIR: " " })).toBe(join(homedir(), ".depotmanagement", "data", "logos"));
    expect(logosDir({})).toBe(join(homedir(), ".depotmanagement", "data", "logos"));
  });
});
