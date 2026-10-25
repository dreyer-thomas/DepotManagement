import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHtml, renderText } from "../../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

class NotFoundError extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

import { prisma } from "@/db";
import { createDepot } from "@/modules/ledger";
import DepotDetailPage, { generateMetadata } from "./page";

beforeEach(async () => {
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const props = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Depot detail page", () => {
  it("calls notFound() for an unknown id", async () => {
    await expect(DepotDetailPage(props("xyz"))).rejects.toBeInstanceOf(NotFoundError);
    expect(await generateMetadata(props("xyz"))).toEqual({ title: "Depot nicht gefunden" });
  });

  it("shows name, Broker, Cash Account and the empty Transactions state", async () => {
    const result = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    if (!result.ok) throw new Error("setup failed");
    const tree = await DepotDetailPage(props(result.depot.id));
    const text = renderText(tree);
    expect(text).toContain("Hauptdepot");
    expect(text).toContain("comdirect");
    expect(text).toContain("Cash-Konto 0,00 €");
    expect(text).toContain("Noch keine Buchungen.");
    expect(renderHtml(tree)).toMatch(/<button[^>]*disabled[^>]*>Neue Buchung/);
    expect(await generateMetadata(props(result.depot.id))).toEqual({ title: "Hauptdepot" });
  });
});
