import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { createDepot, renameDepot } from "@/modules/ledger";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { DepotList } from "../../_components/depots/DepotList";
import DepotsPage from "./page";

beforeEach(async () => {
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("Depots page", () => {
  it("shows the title, the create button and the empty text", async () => {
    const tree = await DepotsPage();
    expect(findElement(tree, CreateDepotButton)).toBeDefined();
    const text = renderText(tree);
    expect(text).toContain("Depots");
    expect(text).toContain("Noch kein Depot.");
  });

  it("lists Depots sorted by name, linking to the detail page, with the current name", async () => {
    const created = await createDepot({ name: "Comdirect Depot", broker: "COMDIRECT" });
    await createDepot({ name: "Bank", broker: "DEUTSCHE_BANK" });
    if (!created.ok) throw new Error("setup failed");
    await renameDepot(created.depot.id, { name: "Hauptdepot" });

    const tree = await DepotsPage();
    expect(findElement(tree, DepotList)?.props.depots).toEqual([
      expect.objectContaining({ name: "Bank" }),
      expect.objectContaining({ name: "Hauptdepot" }),
    ]);
    const text = renderText(tree);
    expect(text).toContain("Bank Deutsche Bank Cash-Konto 0,00 €");
    expect(text).toContain("Hauptdepot comdirect Cash-Konto 0,00 €");
    expect(text).not.toContain("Comdirect Depot");
    expect(text).not.toContain("Noch kein Depot.");
    expect(renderHtml(tree)).toContain(`href="/depots/${created.depot.id}"`);
  });
});
