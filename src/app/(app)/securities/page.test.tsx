import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_actions/securities", () => ({
  resolveMissingMappingsAction: vi.fn(),
  resolveMappingAction: vi.fn(),
  setMappingAction: vi.fn(),
  changeSecurityTypeAction: vi.fn(),
}));

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { setMapping } from "@/modules/prices";
import { MappingAutoResolver } from "../../_components/securities/MappingAutoResolver";
import { SecurityList } from "../../_components/securities/SecurityList";
import SecuritiesPage from "./page";

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  await prisma.providerMapping.deleteMany();
  await prisma.security.deleteMany();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
  dbFile.removeFiles();
});

async function security(identifier: { isin: string } | { cryptoSymbol: string }, name: string, assetType: string) {
  const result = await ensureSecurity(identifier, { name, assetType });
  if (!result.ok) throw new Error("setup failed");
  return result.security;
}

describe("Securities page", () => {
  it("shows the title, the empty text and the CoinGecko attribution", async () => {
    const tree = await SecuritiesPage();
    const text = renderText(tree);
    expect(text).toContain("Wertpapiere");
    expect(text).toContain("Noch keine Wertpapiere.");
    expect(text).toContain("Data provided by CoinGecko");
    expect(renderHtml(tree)).toContain('href="https://www.coingecko.com"');
    expect(findElement(tree, MappingAutoResolver)?.props.pending).toBe(0);
  });

  it("lists every Security with identifier, type and mapping state, without calling a provider", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP", "STOCK");
    const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World", "ETF");
    await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");
    await prisma.security.create({ data: { isin: "LU0274208692", name: "Unbekannt AG", assetType: "UNCLASSIFIED" } });
    await setMapping(sap.id, { provider: "YAHOO", symbol: "SAP.DE" });
    await prisma.providerMapping.create({
      data: { securityId: msci.id, provider: null, symbol: null, origin: "AUTO", updatedAt: "2026-10-26T08:00:00.000Z" },
    });

    const tree = await SecuritiesPage();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findElement(tree, MappingAutoResolver)?.props.pending).toBe(2);
    expect((findElement(tree, SecurityList)?.props.securities as { name: string }[]).map((s) => s.name)).toEqual([
      "Bitcoin",
      "iShares Core MSCI World",
      "SAP",
      "Unbekannt AG",
    ]);
    const text = renderText(tree);
    expect(text).toContain("Bitcoin BTC Krypto Kursquelle noch nicht ermittelt");
    expect(text).toContain("iShares Core MSCI World IE00B4L5Y983 ETF Keine Kursquelle gefunden");
    expect(text).toContain("SAP DE0007164600 Aktie Yahoo Finance · SAP.DE");
    expect(text).toContain("Unbekannt AG LU0274208692 Typ unbekannt");
    expect(text).toContain("Kursquellen werden ermittelt …");
    // "Automatisch suchen" only for the not-found marker.
    expect(text.match(/Automatisch suchen/g)).toHaveLength(1);
    expect(text.match(/Kursquelle bearbeiten/g)).toHaveLength(4);
    expect(text.match(/Typ ändern/g)).toHaveLength(4);
    expect(renderHtml(tree)).toMatch(/MuiChip-colorWarning[^>]*>(?:(?!<\/div>).)*Typ unbekannt/);
  });
});
