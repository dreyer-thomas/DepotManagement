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
vi.mock("@/app/_actions/prices", () => ({
  refreshPricesAction: vi.fn(),
  saveManualPriceAction: vi.fn(),
  updateManualPriceAction: vi.fn(),
  deleteManualPriceAction: vi.fn(),
}));

import { prisma } from "@/db";
import { createDepot, ensureSecurity, recordTrade } from "@/modules/ledger";
import { setManualClassification } from "@/modules/classification";
import { setMapping } from "@/modules/prices";
import { setTeilfreistellungOverride } from "@/modules/tax";
import { MappingAutoResolver } from "../../_components/securities/MappingAutoResolver";
import { PriceRefreshButton } from "../../_components/securities/PriceRefreshButton";
import { SecurityList } from "../../_components/securities/SecurityList";
import SecuritiesPage from "./page";

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  await prisma.securityClassification.deleteMany();
  await prisma.teilfreistellungOverride.deleteMany();
  await prisma.price.deleteMany();
  await prisma.providerMapping.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.depot.deleteMany();
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
    expect(findElement(tree, PriceRefreshButton)).toBeUndefined();
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
    expect(text).toContain("Bitcoin BTC Krypto Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt Kursquelle noch nicht ermittelt");
    expect(text).toContain("iShares Core MSCI World IE00B4L5Y983 ETF Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt Teilfreistellung 0\u00a0% (automatisch) Keine Kursquelle gefunden");
    expect(text).toContain("SAP DE0007164600 Aktie Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt Yahoo Finance · SAP.DE");
    expect(text).toContain("Unbekannt AG LU0274208692 Typ unbekannt Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt");
    expect(text).toContain("Kursquellen werden ermittelt …");
    // "Automatisch suchen" only for the not-found marker.
    expect(text.match(/Automatisch suchen/g)).toHaveLength(1);
    expect(text.match(/Kursquelle bearbeiten/g)).toHaveLength(4);
    expect(text.match(/Typ ändern/g)).toHaveLength(4);
    expect(text.match(/Klassifizierung/g)).toHaveLength(4);
    expect(renderHtml(tree)).toMatch(/MuiChip-colorWarning[^>]*>(?:(?!<\/div>).)*Typ unbekannt/);
  });

  it("passes the Teilfreistellung overrides on and shows the fund summary line and button", async () => {
    const world = await security({ isin: "IE00B4L5Y983" }, "MSCI World", "ETF");
    const bonds = await security({ isin: "IE00B3F81R35" }, "Euro Bonds", "ETF");
    await security({ isin: "DE0007164600" }, "SAP", "STOCK");
    expect(await setManualClassification(world.id, { assetClass: "Aktien" })).toMatchObject({ ok: true });
    expect(await setTeilfreistellungOverride(world.id, "0")).toEqual({ ok: true });

    const tree = await SecuritiesPage();
    expect(findElement(tree, SecurityList)?.props.teilfreistellungOverrides).toEqual({ [world.id]: "0" });
    const text = renderText(tree);
    expect(text).toContain("Teilfreistellung 0\u00a0% (manuell)");
    expect(text).toContain("Teilfreistellung 0\u00a0% (automatisch)");
    const html = renderHtml(tree);
    expect(html).toContain('aria-label="Teilfreistellung bearbeiten – MSCI World"');
    expect(html).toContain(`aria-label="Teilfreistellung bearbeiten – ${bonds.name}"`);
    expect(html).not.toContain('aria-label="Teilfreistellung bearbeiten – SAP"');
  });

  it("shows each Security's classification summary, manual values winning, and passes the classifications on", async () => {
    const sap = await security({ isin: "DE0007164600" }, "SAP", "STOCK");
    await prisma.securityClassification.create({
      data: {
        securityId: sap.id,
        assetClass: "Aktien",
        assetClassSource: "RULE",
        sector: "Technologie",
        sectorSource: "PROVIDER",
        region: "Europa",
        regionSource: "PROVIDER",
        country: "Deutschland",
        countrySource: "PROVIDER",
        companySize: "Large Cap",
        companySizeSource: "PROVIDER",
        currency: "EUR",
        currencySource: "PROVIDER",
        updatedAt: "2026-10-27T08:00:00.000Z",
      },
    });
    expect(await setManualClassification(sap.id, { sector: "Halbleiter" })).toMatchObject({ ok: true });

    const tree = await SecuritiesPage();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(renderText(tree)).toContain("SAP DE0007164600 Aktie Aktien · Halbleiter · Europa · Deutschland · Large Cap · EUR Kursquelle");
    const classifications = findElement(tree, SecurityList)?.props.classifications as Record<string, { sector: unknown }>;
    expect(classifications[sap.id].sector).toEqual({
      value: "Halbleiter",
      source: "manual",
      manual: "Halbleiter",
      automatic: { value: "Technologie", source: "provider" },
    });
  });

  it("shows the refresh button, latest price dates, the stale badge for held Securities and fetch errors", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-26T10:00:00.000Z"), toFake: ["Date"] });
    try {
      const sap = await security({ isin: "DE0007164600" }, "SAP", "STOCK");
      const msci = await security({ isin: "IE00B4L5Y983" }, "iShares Core MSCI World", "ETF");
      const idle = await security({ isin: "US0378331005" }, "Apple", "STOCK");
      const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
      if (!depot.ok) throw new Error("setup failed");
      for (const [id, date] of [
        [sap.id, "2026-10-01"],
        [msci.id, "2026-10-01"],
      ]) {
        const trade = await recordTrade({ depotId: depot.depot.id, type: "BUY", date, quantity: "1", price: "100", security: { id } });
        if (!trade.ok) throw new Error("setup failed");
      }
      await setMapping(sap.id, { provider: "YAHOO", symbol: "SAP.DE" });
      await setMapping(msci.id, { provider: "YAHOO", symbol: "EUNL.DE" });
      await prisma.providerMapping.update({ where: { securityId: msci.id }, data: { fetchError: "network" } });
      const at = "2026-10-24T18:00:00.000Z";
      await prisma.price.createMany({
        data: [
          { securityId: sap.id, date: "2026-10-24", source: "PROVIDER", price: "200", fetchedAt: at },
          { securityId: msci.id, date: "2026-10-22", source: "PROVIDER", price: "90", fetchedAt: at },
          // Not held: an old price shows its date but no badge.
          { securityId: idle.id, date: "2026-10-01", source: "MANUAL", price: "150", fetchedAt: at },
        ],
      });

      const tree = await SecuritiesPage();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(findElement(tree, PriceRefreshButton)).toBeDefined();
      const text = renderText(tree);
      expect(text).toContain("Kurse aktualisieren");
      expect(text).toContain("Apple US0378331005 Aktie Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt Kursquelle noch nicht ermittelt Kurs vom 01.10.2026 Manuelle Kurse 01.10.2026 150\u00a0€ Bearbeiten Löschen");
      expect(text).toContain("Yahoo Finance · EUNL.DE Kurs vom 22.10.2026 – veraltet Kurs konnte nicht von Yahoo Finance geladen werden. Kurs manuell eintragen");
      expect(text).toContain("Yahoo Finance · SAP.DE Kurs vom 24.10.2026 Kursquelle bearbeiten");
      expect(text.match(/veraltet/g)).toHaveLength(1);
      // One "Kurs manuell eintragen" per card (the failed card has it only in its Alert).
      expect(text.match(/Kurs manuell eintragen/g)).toHaveLength(3);
      expect(text.match(/Manuelle Kurse/g)).toHaveLength(1);
      expect(findElement(tree, SecurityList)?.props.manualPrices).toEqual({
        [idle.id]: [{ id: expect.any(String), date: "2026-10-01", price: "150" }],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
