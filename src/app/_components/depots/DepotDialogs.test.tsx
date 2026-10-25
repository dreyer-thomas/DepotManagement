import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";
import { DeleteDepotForm } from "./DepotDialogs";

describe("DeleteDepotForm", () => {
  const depot = { id: "d1", name: "Hauptdepot", transactionCount: 7 };
  const render = () => <DeleteDepotForm depot={depot} onClose={() => {}} cancelRef={createRef<HTMLButtonElement>()} />;

  it("states the Transaction count and that it cannot be undone, and asks for the name", () => {
    const text = renderText(render());
    expect(text).toContain("Depot „Hauptdepot“ mit 7 Buchungen endgültig löschen? Das kann nicht rückgängig gemacht werden.");
    expect(text).toContain("Zum Bestätigen „Hauptdepot“ eingeben");
    expect(text).toContain("Abbrechen");
  });

  it("keeps Löschen disabled until the name is typed and submits id and confirmName", () => {
    const html = renderHtml(render());
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Löschen/);
    expect(html).toMatch(/<input[^>]*name="id"[^>]*value="d1"/);
    expect(html).toMatch(/<input[^>]*name="confirmName"/);
  });
});
