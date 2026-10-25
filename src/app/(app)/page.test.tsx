import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

import { prisma } from "@/db";
import { createDepot } from "@/modules/ledger";
import { CreateDepotButton } from "../_components/depots/DepotDialogs";
import { DepotList } from "../_components/depots/DepotList";
import OverviewPage from "./page";

beforeEach(async () => {
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("Overview page", () => {
  it("shows the empty state with 'Depot anlegen' and a disabled 'Aus Parqet übernehmen'", async () => {
    const tree = await OverviewPage();
    expect(findElement(tree, DepotList)).toBeUndefined();
    expect(findElement(tree, CreateDepotButton)?.props.label).toBe("Depot anlegen");
    const text = renderText(tree);
    expect(text).toContain("Noch kein Depot.");
    expect(text).toContain("Depot anlegen");
    expect(renderHtml(tree)).toMatch(/<button[^>]*disabled[^>]*>Aus Parqet übernehmen/);
  });

  it("lists the Depots with Broker and a zero Cash Account balance", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    await createDepot({ name: "ZERO", broker: "FINANZEN_ZERO" });
    const tree = await OverviewPage();
    const text = renderText(tree);
    expect(text).not.toContain("Noch kein Depot.");
    expect(text).toContain("Hauptdepot comdirect Cash-Konto 0,00 €");
    expect(text).toContain("ZERO finanzen.net zero Cash-Konto 0,00 €");
    expect(findElement(tree, DepotList)?.props.renamable).toBeFalsy();
  });
});
