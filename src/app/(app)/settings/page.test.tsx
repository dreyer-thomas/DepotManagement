import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { createDepot } from "@/modules/ledger";
import { CreateDepotButton } from "../../_components/depots/DepotDialogs";
import { DepotList } from "../../_components/depots/DepotList";
import SettingsPage from "./page";

beforeEach(async () => {
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("Settings page", () => {
  it("shows the Depots section with the create button when empty", async () => {
    const tree = await SettingsPage();
    expect(findElement(tree, CreateDepotButton)).toBeDefined();
    const text = renderText(tree);
    expect(text).toContain("Einstellungen");
    expect(text).toContain("Depots");
    expect(text).toContain("Noch kein Depot.");
  });

  it("lists Depots with a rename button each", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    const tree = await SettingsPage();
    expect(findElement(tree, DepotList)?.props.renamable).toBe(true);
    expect(renderText(tree)).toContain("Hauptdepot comdirect Cash-Konto 0,00 €");
    expect(renderHtml(tree)).toContain('aria-label="&quot;Hauptdepot&quot; umbenennen"');
  });
});
