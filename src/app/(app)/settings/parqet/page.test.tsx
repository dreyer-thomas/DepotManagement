import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { archiveDepot, createDepot } from "@/modules/ledger";
import { CreateDepotButton } from "../../../_components/depots/DepotDialogs";
import { ParqetMigrationWizard } from "../../../_components/migration/ParqetMigrationWizard";
import ParqetMigrationPage from "./page";

beforeEach(async () => {
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("Parqet migration page", () => {
  it("asks for a Depot first when none exists", async () => {
    const tree = await ParqetMigrationPage();
    expect(findElement(tree, ParqetMigrationWizard)).toBeUndefined();
    expect(findElement(tree, CreateDepotButton)).toBeDefined();
    const text = renderText(tree);
    expect(text).toContain("Aus Parqet übernehmen");
    expect(text).toContain("Lege zuerst ein Depot an.");
    const html = renderHtml(tree);
    expect(html).toMatch(/<a(?=[^>]*aria-label="Zurück zu Einstellungen")(?=[^>]*href="\/settings")[^>]*>/);
  });

  it("asks for a Depot first when every Depot is archived", async () => {
    const old = await createDepot({ name: "Alt", broker: "COMDIRECT" });
    if (!old.ok) throw new Error("setup failed");
    expect((await archiveDepot(old.depot.id)).ok).toBe(true);
    const tree = await ParqetMigrationPage();
    expect(findElement(tree, ParqetMigrationWizard)).toBeUndefined();
    expect(renderText(tree)).toContain("Lege zuerst ein Depot an.");
  });

  it("offers the wizard with the non-archived Depots only", async () => {
    const active = await createDepot({ name: "Hauptdepot", broker: "FINANZEN_ZERO" });
    const old = await createDepot({ name: "Alt", broker: "COMDIRECT" });
    if (!active.ok || !old.ok) throw new Error("setup failed");
    expect((await archiveDepot(old.depot.id)).ok).toBe(true);
    const tree = await ParqetMigrationPage();
    expect(findElement(tree, ParqetMigrationWizard)?.props.depots).toEqual([{ id: active.depot.id, name: "Hauptdepot" }]);
    expect(findElement(tree, CreateDepotButton)).toBeUndefined();
  });
});
