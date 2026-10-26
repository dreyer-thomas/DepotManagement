import { describe, expect, it } from "vitest";
import { editableFields } from "./edit-fields";

describe("editableFields", () => {
  it("lists the editable fields per proposal type", () => {
    expect(editableFields("BUY")).toEqual(["date", "quantity", "price", "amount", "fee", "tax"]);
    expect(editableFields("SELL")).toEqual(["date", "quantity", "price", "amount", "fee", "tax"]);
    expect(editableFields("DIVIDEND")).toEqual(["date", "amount", "fee", "tax"]);
    expect(editableFields("FEE")).toEqual(["date", "fee"]);
    expect(editableFields("TAX")).toEqual(["date", "tax"]);
  });
});
