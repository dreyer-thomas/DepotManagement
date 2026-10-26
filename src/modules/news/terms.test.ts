import { describe, expect, it } from "vitest";
import { newsTerm } from "./terms";

describe("newsTerm", () => {
  it.each([
    ["SAP SE", "SAP"],
    ["Siemens AG", "Siemens"],
    ["Henkel AG & Co. KGaA", "Henkel"],
    ["Apple Inc.", "Apple"],
    ["Microsoft Corporation", "Microsoft"],
    ["NVIDIA Corp", "NVIDIA"],
    ["Unilever PLC", "Unilever"],
    ["ASML Holding N.V.", "ASML"],
    ["Airbus SE", "Airbus"],
    ["Banco Santander, S.A.", "Banco Santander"],
    ["Muster GmbH & Co. KG", "Muster"],
    ["Novo Nordisk A/S", "Novo Nordisk"],
    ["Equinor ASA", "Equinor"],
    ["Volvo AB", "Volvo"],
    ["Nokia Oyj", "Nokia"],
    ["Ferrari S.p.A.", "Ferrari"],
    ["Beispiel LLC", "Beispiel"],
    ["Muster Aktiengesellschaft", "Muster"],
    ["Example Limited", "Example"],
    ["Beispiel Holdings Ltd.", "Beispiel"],
    ["  Deutsche   Telekom  AG ", "Deutsche Telekom"],
    ["iShares Core MSCI World UCITS ETF USD (Acc)", "iShares Core MSCI World UCITS ETF USD (Acc)"],
    ["Bitcoin", "Bitcoin"],
    ["AG", "AG"],
    ["Holding SE", "Holding SE"],
  ])("%s → %s", (name, term) => {
    expect(newsTerm(name)).toBe(term);
  });
});
