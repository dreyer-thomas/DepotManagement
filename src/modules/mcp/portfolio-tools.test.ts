import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { effective } from "@/core/classification";
import { holdingShares, holdingTotals } from "@/core/composition";
import { lastPerMonth } from "@/core/dates";
import { dividendAnalysis } from "@/core/dividend-analysis";
import { gainsAnalysis } from "@/core/gains-analysis";
import { isStale } from "@/core/prices";
import { allocationAnalysis, listClassifications, listKeyFigures, setManualClassification, setManualRegionSplit } from "@/modules/classification";
import {
  archiveDepot,
  benchmarkLines,
  createDepot,
  depotValuation,
  dividendAnalysisInput,
  ensureBenchmarkSecurities,
  ensureSecurity,
  gainsInput,
  listDepots,
  listPositions,
  listTransactions,
  portfolioValuation,
  recordTransaction,
  type RecordTransactionInput,
  securityDetail,
  valuationSummary,
} from "@/modules/ledger";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";
import { PORTFOLIO_READ_DENIED_MESSAGE, PORTFOLIO_TOOL_NAMES, requirePortfolioRead } from "./portfolio-tools";
import { createMcpServer } from "./server";
import { keyFiguresPayload, type McpToolContext } from "./tools";

const TODAY = "2026-10-28";
const DENIED = { error: "portfolio-read-required", message: PORTFOLIO_READ_DENIED_MESSAGE };

let testDb: TestDatabase;
const db = () => testDb.client;
const history = { storedPrices: (ids: string[], asOf: string) => storedPriceHistory(ids, asOf, db()) };
const latest = { storedPrices: (ids: string[], asOf: string) => latestStoredPrices(ids, asOf, db()) };

type Fixture = { main: string; old: string; sap: string; etf: string; watched: string; unpriced: string };
let fx: Fixture;

async function book(input: RecordTransactionInput) {
  const result = await recordTransaction(input, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
}

async function price(securityId: string, date: string, value: string) {
  await db().price.create({ data: { securityId, date, source: "PROVIDER", price: value, fetchedAt: `${date}T18:00:00.000Z` } });
}

/** Two Depots (one archived), buys, a sell, a dividend, a fee, a tax refund, deposits, stored prices, a classification, a region split and a benchmark price. */
async function seed(): Promise<Fixture> {
  const main = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  const old = await createDepot({ name: "Altdepot", broker: "FINANZEN_ZERO" }, db());
  const sap = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" }, db());
  const etf = await ensureSecurity({ isin: "IE00BK5BQT80" }, { name: "Welt ETF", assetType: "ETF" }, db());
  const watched = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, db());
  const unpriced = await ensureSecurity({ isin: "DE000BASF111" }, { name: "Ohne Kurs AG", assetType: "STOCK" }, db());
  if (!main.ok || !old.ok || !sap.ok || !etf.ok || !watched.ok || !unpriced.ok) throw new Error("setup failed");
  const ids = {
    main: main.depot.id,
    old: old.depot.id,
    sap: sap.security.id,
    etf: etf.security.id,
    watched: watched.security.id,
    unpriced: unpriced.security.id,
  };
  await book({ depotId: ids.main, type: "DEPOSIT", date: "2025-11-03", amount: "10000" });
  await book({ depotId: ids.main, type: "BUY", date: "2025-11-10", quantity: "10", price: "100", fee: "1", security: { id: ids.sap } });
  await book({ depotId: ids.main, type: "BUY", date: "2026-01-05", quantity: "20", price: "50", security: { id: ids.etf } });
  await book({ depotId: ids.main, type: "SELL", date: "2026-05-04", quantity: "4", price: "120", fee: "1", tax: "3", security: { id: ids.sap } });
  await book({ depotId: ids.main, type: "DIVIDEND", date: "2026-06-01", amount: "20", tax: "5", security: { id: ids.sap } });
  await book({ depotId: ids.main, type: "FEE", date: "2026-07-01", fee: "2" });
  await book({ depotId: ids.main, type: "TAX", date: "2026-08-03", tax: "-1" });
  // A holding correction gives a Position without any price (ADJUSTMENT costs are no price observations).
  await book({ depotId: ids.main, type: "ADJUSTMENT", date: "2026-02-02", quantity: "5", price: "10", security: { id: ids.unpriced } });
  await book({ depotId: ids.old, type: "DEPOSIT", date: "2025-12-01", amount: "100" });
  await book({ depotId: ids.old, type: "BUY", date: "2025-12-02", quantity: "1", price: "90", security: { id: ids.sap } });
  await book({ depotId: ids.old, type: "SELL", date: "2025-12-20", quantity: "1", price: "95", security: { id: ids.sap } });
  await book({ depotId: ids.old, type: "WITHDRAWAL", date: "2025-12-21", amount: "105" });
  if (!(await archiveDepot(ids.old, db())).ok) throw new Error("setup failed");
  for (const [date, value] of [["2026-09-30", "130"], ["2026-10-27", "140"]]) await price(ids.sap, date, value);
  for (const [date, value] of [["2026-09-30", "55"], ["2026-10-20", "60"]]) await price(ids.etf, date, value);
  await price(ids.watched, "2026-10-27", "200");
  const [msciWorld] = await ensureBenchmarkSecurities(db());
  for (const [date, value] of [["2025-10-01", "80"], ["2026-03-31", "90"], ["2026-10-27", "100"]]) await price(msciWorld, date, value);
  await setManualClassification(ids.sap, { assetClass: "Aktien", sector: "Technologie" }, db());
  await setManualRegionSplit(ids.etf, { USA: "70", Europa: "30" }, db());
  await db().securityKeyFigures.create({
    data: {
      securityId: ids.sap,
      symbol: "SAP.DE",
      kind: "stock",
      figures: JSON.stringify({ trailingPE: "30.4321", dividendYield: "0.0118" }),
      analystSymbol: "SAP.DE",
      analysts: JSON.stringify({
        trend: [{ period: "0m", strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 }],
        analystCount: 49,
        consensusMean: "1.85",
        target: { low: "200", mean: "270", median: "272.5", high: "310", currentPrice: "240", currency: "EUR" },
        changes: [],
      }),
      fetchedAt: "2026-10-27T09:00:00.000Z",
    },
  });
  return ids;
}

function context(scopes: string[]): McpToolContext {
  return {
    db: db(),
    today: TODAY,
    scopes,
    clientName: "Claude",
    lookupIsin: async () => ({ status: "not-found" }),
    onWatchlistChange: () => {},
  };
}

async function client(scopes = ["watchlist", "portfolio:read"]): Promise<Client> {
  const server = createMcpServer(context(scopes));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test-client", version: "1.0.0" });
  await mcp.connect(clientTransport);
  return mcp;
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

let mcp: Client;

async function call(name: string, args: Record<string, unknown> = {}, on: Client = mcp) {
  const result = (await on.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content[0].text;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { isError: result.isError === true, payload: payload as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const refused = (error: string) => ({ isError: true, payload: { error, message: expect.any(String) } });

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  testDb = createTestDatabase();
  fx = await seed();
  mcp = await client();
});

afterEach(async () => {
  await mcp.close();
  vi.restoreAllMocks();
  await testDb.cleanup();
});

const performanceFigures = (p: { gain: string; realized: string; unrealized: string; dividends: string; fees: string; taxesPaid: string; ttwror: string | null; xirr: string | null }) => ({
  gain: p.gain,
  realized: p.realized,
  unrealized: p.unrealized,
  dividends: p.dividends,
  fees: p.fees,
  taxes: p.taxesPaid,
  ttwror: p.ttwror,
  xirr: p.xirr,
});

describe("get_portfolio_summary", () => {
  it("equals the Overview's figures for the default Period 1J", async () => {
    const { isError, payload } = await call("get_portfolio_summary");
    expect(isError).toBe(false);
    const portfolio = await portfolioValuation({ kind: "preset", preset: "1J" }, TODAY, db(), history);
    const summary = valuationSummary(portfolio);
    expect(payload).toEqual({
      period: "1J",
      from: summary.from,
      to: summary.to,
      value: summary.value,
      invested_capital: summary.investedCapital,
      cash: summary.cash,
      ...performanceFigures(summary.performance),
      dividends: summary.dividends,
      taxes: summary.taxesPaid,
      has_transactions: true,
      depots: portfolio.depots.map(({ id, name, valuation }) => ({
        id,
        name,
        value: valuation.series.at(-1)?.value ?? "0",
        gain: valuation.performance.gain,
        ttwror: valuation.performance.ttwror,
        xirr: valuation.performance.xirr,
      })),
    });
    expect(payload.depots.map((depot: { name: string }) => depot.name)).toEqual(["Hauptdepot"]);
    expect(payload.from).toBe("2025-10-28");
    expect(payload.value).toBe("10529");
  });

  it("takes a custom Period and refuses an invalid one", async () => {
    const { payload } = await call("get_portfolio_summary", { period: "custom:2026-01-01:2026-06-30" });
    expect(payload).toMatchObject({ period: "custom:2026-01-01:2026-06-30", from: "2026-01-01", to: "2026-06-30" });
    const portfolio = await portfolioValuation({ kind: "custom", from: "2026-01-01", to: "2026-06-30" }, TODAY, db(), history);
    expect(payload.value).toBe(valuationSummary(portfolio).value);
    for (const period of ["custom:2026-01-01:2026-10-29", "5J", "custom:2026-06-30:2026-01-01", ""]) {
      expect(await call("get_portfolio_summary", { period })).toEqual(refused("period-invalid"));
    }
  });
});

describe("get_depot", () => {
  it("returns the list_depots fields plus the Depot page's figures; archived Depots too", async () => {
    const { payload } = await call("get_depot", { depot_id: fx.main, period: "MAX" });
    const depot = (await listDepots(db())).find((candidate) => candidate.id === fx.main)!;
    const summary = valuationSummary(await depotValuation(fx.main, { kind: "preset", preset: "MAX" }, TODAY, db(), history));
    expect(payload).toEqual({
      id: fx.main,
      name: "Hauptdepot",
      broker: "COMDIRECT",
      archived: false,
      cash_balance: depot.cashBalance,
      period: "MAX",
      from: "2025-11-03",
      to: TODAY,
      value: summary.value,
      invested_capital: summary.investedCapital,
      cash: summary.cash,
      ...performanceFigures(summary.performance),
      dividends: summary.dividends,
      taxes: summary.taxesPaid,
      has_transactions: true,
    });
    const archived = await call("get_depot", { depot_id: fx.old });
    expect(archived.payload).toMatchObject({ archived: true, has_transactions: true, value: "0" });
  });

  it("gives null figures for a Depot without Transactions and refuses an unknown id", async () => {
    const empty = await createDepot({ name: "Leer", broker: "COMDIRECT" }, db());
    if (!empty.ok) throw new Error("setup failed");
    const { payload } = await call("get_depot", { depot_id: empty.depot.id });
    expect(payload).toMatchObject({ has_transactions: false, from: "2025-10-28", to: TODAY, value: null, gain: null, ttwror: null, xirr: null, cash_balance: "0" });
    expect(await call("get_depot", { depot_id: "nope" })).toEqual(refused("depot-not-found"));
  });
});

describe("list_positions", () => {
  it("lists the Positions of the non-archived Depots as listPositions gives them, with stale flag and share", async () => {
    const { payload } = await call("list_positions");
    const depots = (await listDepots(db())).filter((depot) => !depot.archived);
    const positions = (await Promise.all(depots.map((depot) => listPositions(depot.id, TODAY, db(), latest)))).flatMap((list, index) =>
      list.map((position) => ({ depot: depots[index], position })),
    );
    const values = positions.map(({ position }) => position.value);
    const cash = depots.map((depot) => depot.cashBalance);
    const shares = holdingShares(values, cash);
    expect(payload).toEqual({
      as_of: TODAY,
      positions: positions.map(({ depot, position }, index) => ({
        depot_id: depot.id,
        depot_name: depot.name,
        security: {
          id: position.security.id,
          name: position.security.name,
          isin: position.security.isin,
          crypto_symbol: position.security.cryptoSymbol,
          asset_type: position.security.assetType,
        },
        quantity: position.quantity,
        price: position.price,
        price_date: position.priceDate,
        stale: position.priceDate === null ? false : isStale(position.priceDate, TODAY),
        value: position.value,
        cost_basis: position.costBasis,
        average_price: position.averagePrice,
        gain: position.gain,
        gain_ratio: position.gainRatio,
        share: shares[index],
      })),
      positions_value: holdingTotals(values, cash).positionsValue,
      cash: holdingTotals(values, cash).cash,
    });
    expect(payload.positions.map((row: { security: { name: string }; stale: boolean }) => [row.security.name, row.stale])).toEqual(
      expect.arrayContaining([
        ["SAP SE", false],
        ["Welt ETF", true],
      ]),
    );
    expect(payload.positions_value).toBe("2040");
    const unpriced = payload.positions.find((row: { security: { id: string } }) => row.security.id === fx.unpriced);
    expect(unpriced).toMatchObject({ quantity: "5", price: null, price_date: null, stale: false, value: null, gain: null, share: null });
  });

  it("allows an archived Depot by id and refuses an unknown one", async () => {
    expect((await call("list_positions", { depot_id: fx.old })).payload).toEqual({ as_of: TODAY, positions: [], positions_value: "0", cash: "0" });
    expect(await call("list_positions", { depot_id: "nope" })).toEqual(refused("depot-not-found"));
  });
});

describe("list_transactions", () => {
  it("returns every Depot's Transactions (archived included) newest first, each with its depot_id", async () => {
    const { payload } = await call("list_transactions");
    const all = [...(await listTransactions(fx.main, db())), ...(await listTransactions(fx.old, db()))].sort(
      (a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence || b.id.localeCompare(a.id),
    );
    expect(payload.next_cursor).toBeNull();
    expect(payload.transactions).toEqual(
      all.map((row) => ({
        id: row.id,
        depot_id: row.depotId,
        date: row.date,
        sequence: row.sequence,
        type: row.type,
        security: row.security
          ? { id: row.security.id, name: row.security.name, isin: row.security.isin, crypto_symbol: row.security.cryptoSymbol, asset_type: row.security.assetType }
          : null,
        quantity: row.quantity,
        price: row.price,
        amount: row.amount,
        fee: row.fee,
        tax: row.tax,
        note: row.note,
      })),
    );
  });

  it("filters, pages with the cursor and refuses bad arguments", async () => {
    const filtered = await call("list_transactions", { depot_id: fx.main, types: ["BUY", "SELL"], security_id: fx.sap, from: "2025-11-01", to: "2026-05-31" });
    expect(filtered.payload.transactions.map((row: { type: string; date: string }) => [row.type, row.date])).toEqual([
      ["SELL", "2026-05-04"],
      ["BUY", "2025-11-10"],
    ]);
    const first = await call("list_transactions", { limit: 4 });
    const second = await call("list_transactions", { limit: 4, cursor: first.payload.next_cursor });
    const third = await call("list_transactions", { limit: 4, cursor: second.payload.next_cursor });
    const all = await call("list_transactions");
    expect([...first.payload.transactions, ...second.payload.transactions, ...third.payload.transactions]).toEqual(all.payload.transactions);
    expect(third.payload.next_cursor).toBeNull();
    expect(await call("list_transactions", { cursor: "kaputt" })).toEqual(refused("cursor-invalid"));
    expect(await call("list_transactions", { depot_id: "nope" })).toEqual(refused("depot-not-found"));
    expect(await call("list_transactions", { security_id: "nope" })).toEqual(refused("security-not-found"));
    expect((await call("list_transactions", { limit: 501 })).isError).toBe(true);
    expect((await call("list_transactions", { from: "2026-13-45" })).isError).toBe(true);
    expect((await call("list_transactions", { to: "2026-02-30" })).isError).toBe(true);
    expect((await call("list_transactions", { types: ["GIFT"] })).isError).toBe(true);
  });
});

describe("list_transactions paging (acceptance)", () => {
  it("pages more than 500 Transactions with limit 500: every page ≤ 500 rows, no repeats, last next_cursor null", async () => {
    await db().transaction.createMany({
      data: Array.from({ length: 1103 }, (_, index) => ({
        depotId: fx.main,
        type: "DEPOSIT" as const,
        date: `2024-0${1 + (index % 9)}-${String(1 + (index % 28)).padStart(2, "0")}`,
        sequence: index,
        amount: "1",
        fee: "0",
        tax: "0",
      })),
    });
    const total = await db().transaction.count();
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const { isError, payload } = await call("list_transactions", { limit: 500, ...(cursor ? { cursor } : {}) });
      expect(isError).toBe(false);
      expect(payload.transactions.length).toBeLessThanOrEqual(500);
      ids.push(...payload.transactions.map((row: { id: string }) => row.id));
      pages++;
      if (payload.next_cursor === null) break;
      cursor = payload.next_cursor;
    }
    expect(pages).toBe(Math.ceil(total / 500));
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });
});

describe("get_performance", () => {
  it("returns the daily points of the Portfolio with the TTWROR line, and the benchmark line", async () => {
    const { payload } = await call("get_performance", { benchmark: "msci-world" });
    const portfolio = await portfolioValuation({ kind: "preset", preset: "1J" }, TODAY, db(), history);
    const points = [portfolio.start, ...portfolio.series].map((point, index) => ({
      date: point.date,
      value: point.value,
      invested_capital: point.investedCapital,
      ttwror: portfolio.performanceLine[index].performance,
    }));
    const line = (await benchmarkLines(portfolio.start.date, portfolio.to, db(), history))["msci-world"]!;
    expect(payload).toEqual({
      depot_id: null,
      period: "1J",
      from: portfolio.from,
      to: portfolio.to,
      interval: "day",
      ttwror: portfolio.performance.ttwror,
      xirr: portfolio.performance.xirr,
      points,
      benchmark: { key: "msci-world", label: "MSCI World", ttwror: line.at(-1)!.performance, points: line },
    });
    expect(payload.points.at(-1).ttwror).toBe(portfolio.performance.ttwror);
  });

  it("samples month ends for one Depot and gives a null benchmark without stored prices", async () => {
    const { payload } = await call("get_performance", { depot_id: fx.main, period: "YTD", interval: "month", benchmark: "dax" });
    const valuation = await depotValuation(fx.main, { kind: "preset", preset: "YTD" }, TODAY, db(), history);
    const points = [valuation.start, ...valuation.series].map((point, index) => ({
      date: point.date,
      value: point.value,
      invested_capital: point.investedCapital,
      ttwror: valuation.performanceLine[index].performance,
    }));
    expect(payload.points).toEqual(lastPerMonth(points));
    expect(payload.points.map((point: { date: string }) => point.date).slice(0, 3)).toEqual(["2025-12-31", "2026-01-31", "2026-02-28"]);
    expect(payload.benchmark).toBeNull();
    expect(payload.depot_id).toBe(fx.main);
    const monthly = await call("get_performance", { depot_id: fx.main, period: "YTD", interval: "month", benchmark: "msci-world" });
    const line = (await benchmarkLines(valuation.start.date, valuation.to, db(), history))["msci-world"]!;
    expect(line.length).toBeGreaterThan(12);
    expect(monthly.payload.benchmark).toEqual({ key: "msci-world", label: "MSCI World", ttwror: line.at(-1)!.performance, points: lastPerMonth(line) });
    expect((await call("get_performance", { benchmark: "nikkei" })).isError).toBe(true);
    expect(await call("get_performance", { depot_id: "nope" })).toEqual(refused("depot-not-found"));
    expect(await call("get_performance", { period: "custom:2026-01-01" })).toEqual(refused("period-invalid"));
  });
});

describe("get_allocation", () => {
  it("equals allocationAnalysis, with the German labels and the region split", async () => {
    const { payload } = await call("get_allocation", { dimension: "region" });
    const expected = await allocationAnalysis("portfolio", "region", TODAY, db(), latest);
    expect(payload).toEqual({
      as_of: TODAY,
      depot_id: null,
      dimension: "region",
      dimension_label: "Region",
      segments: expected.segments.map((segment) => ({
        key: segment.key,
        kind: segment.kind,
        label: segment.label,
        amount: segment.amount,
        share: segment.share,
        positions: (expected.positions[segment.key] ?? []).map((position) => ({
          security_id: position.securityId,
          security_name: position.securityName,
          depot_id: position.depotId,
          depot_name: position.depotName,
          value: position.value,
          share: position.share,
          ...(position.weight !== undefined ? { weight: position.weight } : {}),
        })),
      })),
    });
    expect(payload.segments.map((segment: { label: string }) => segment.label)).toEqual(["USA", "Europa", "Unbekannt", "Guthaben"]);
  });

  it("defaults to the asset class and takes one Depot", async () => {
    const { payload } = await call("get_allocation", { depot_id: fx.main });
    const expected = await allocationAnalysis({ depotId: fx.main }, "assetClass", TODAY, db(), latest);
    expect(payload.dimension).toBe("assetClass");
    expect(payload.segments.map((segment: { label: string; amount: string }) => [segment.label, segment.amount])).toEqual(
      expected.segments.map((segment) => [segment.label, segment.amount]),
    );
    expect(payload.segments.map((segment: { label: string }) => segment.label)).toEqual(["Aktien", "Unbekannt", "Guthaben"]);
    expect(await call("get_allocation", { depot_id: "nope" })).toEqual(refused("depot-not-found"));
    expect((await call("get_allocation", { dimension: "color" })).isError).toBe(true);
  });
});

describe("get_income", () => {
  it.each(["month", "year"] as const)("equals the dividends and gains analyses per %s", async (granularity) => {
    const { payload } = await call("get_income", { granularity });
    const gainsIn = await gainsInput("portfolio", db());
    const dividendsIn = await dividendAnalysisInput("portfolio", TODAY, db(), latest);
    const gains = gainsAnalysis(gainsIn.depots, gainsIn.actions, TODAY);
    const dividends = dividendAnalysis(dividendsIn.depots, dividendsIn.actions, TODAY);
    const pick = <T,>(months: T[], years: T[]) => (granularity === "year" ? years : months);
    expect(payload).toEqual({
      depot_id: null,
      granularity,
      dividends: pick(dividends.months, dividends.years).map(({ period, gross, net }) => ({ period, gross, net })),
      gains: pick(gains.months, gains.years).map((bucket) => ({
        period: bucket.period,
        realized: bucket.realized,
        dividends: bucket.dividends,
        fees: bucket.fees,
        taxes: bucket.taxes,
        deposits: bucket.deposits,
        withdrawals: bucket.withdrawals,
        net_cash_flow: bucket.netCashFlow,
      })),
    });
    if (granularity === "year") expect(payload.dividends).toEqual([{ period: "2025", gross: "0", net: "0" }, { period: "2026", gross: "20", net: "15" }]);
  });

  it("takes an archived Depot by id and refuses an unknown one", async () => {
    const { payload } = await call("get_income", { depot_id: fx.old, granularity: "year" });
    expect(payload.gains).toEqual([
      expect.objectContaining({ period: "2025", realized: "5", deposits: "100", withdrawals: "105" }),
      expect.objectContaining({ period: "2026", realized: "0", deposits: "0" }),
    ]);
    expect(await call("get_income", { depot_id: "nope" })).toEqual(refused("depot-not-found"));
  });
});

describe("get_security", () => {
  it("equals securityDetail with held, booked, classification and key figures", async () => {
    const { payload } = await call("get_security", { security_id: fx.sap, period: "MAX" });
    const detail = (await securityDetail(fx.sap, undefined, { kind: "preset", preset: "MAX" }, TODAY, db(), history))!;
    const end = detail.series.at(-1) ?? detail.start;
    expect(payload).toMatchObject({
      security: { id: fx.sap, name: "SAP SE", isin: "DE0007164600", crypto_symbol: null, asset_type: "STOCK" },
      held: true,
      booked: true,
      depots: [{ id: fx.main, name: "Hauptdepot", archived: false }, { id: fx.old, name: "Altdepot", archived: true }].sort((a, b) => a.name.localeCompare(b.name)),
      selected_depot_id: null,
      period: "MAX",
      from: detail.from,
      to: detail.to,
      price: detail.price!.price,
      price_date: detail.price!.date,
      price_source: detail.price!.source,
      stale: false,
      performance: { value: end.value, ...performanceFigures(detail.performance), price_change: detail.priceChange && { per_unit: detail.priceChange.perUnit, ratio: detail.priceChange.ratio } },
      snapshot: {
        quantity: detail.snapshot.quantity,
        cost_basis: detail.snapshot.costBasis,
        value: detail.snapshot.value,
        unrealized: detail.snapshot.unrealized,
        average_price: detail.snapshot.averagePrice,
      },
      all_time: {
        realized: detail.total.realized,
        unrealized: detail.total.unrealized,
        dividends: detail.total.dividends,
        fees: detail.total.fees,
        taxes_paid: detail.total.taxesPaid,
        total: detail.total.total,
        total_invested: detail.total.totalInvested,
        return_ratio: detail.total.returnRatio,
        xirr: detail.total.xirr,
        value: detail.total.value,
      },
      key_figures: keyFiguresPayload(detail.fiftyTwoWeek, (await listKeyFigures([fx.sap], TODAY, db()))[fx.sap]),
    });
    const classification = (await listClassifications(db()))[fx.sap];
    expect(payload.classification).toMatchObject({ type: "STOCK", asset_class: { value: "Aktien", source: "manual" }, sector: { value: classification.sector.value, source: "manual" } });
    expect(payload.snapshot.quantity).toBe("6");
    expect(payload.key_figures).toMatchObject({ as_of: "2026-10-27", trailing_pe: "30.4321" });
    expect(payload.key_figures.analysts).toMatchObject({ symbol: "SAP.DE", consensus_mean: "1.85", analyst_count: 49 });
  });

  it("works for a watched, never booked Security and for one Depot; refuses unknown ids", async () => {
    const watched = await call("get_security", { security_id: fx.watched });
    expect(watched.payload).toMatchObject({ held: false, booked: false, depots: [], price: "200", price_date: "2026-10-27" });
    expect(watched.payload.classification).toEqual(
      expect.objectContaining({ type: "STOCK", asset_class: { value: effective(null, "STOCK").assetClass.value, source: null } }),
    );
    const old = await call("get_security", { security_id: fx.sap, depot_id: fx.old, period: "MAX" });
    expect(old.payload).toMatchObject({ selected_depot_id: fx.old, all_time: { realized: "5" } });
    expect(await call("get_security", { security_id: "nope" })).toEqual(refused("security-not-found"));
    expect(await call("get_security", { security_id: fx.sap, depot_id: "nope" })).toEqual(refused("depot-not-found"));
    expect(await call("get_security", { security_id: fx.watched, depot_id: fx.main })).toEqual({
      isError: true,
      payload: { error: "security-not-in-depot", message: "Dieses Wertpapier wurde in diesem Depot nicht gebucht." },
    });
    expect(await call("get_security", { security_id: fx.sap, period: "1X" })).toEqual(refused("period-invalid"));
  });
});

describe("without portfolio:read", () => {
  it.each(PORTFOLIO_TOOL_NAMES.filter((name) => name !== "list_depots"))("refuses %s without data", async (name) => {
    const plain = await client(["watchlist"]);
    const args: Record<string, unknown> = name === "get_depot" ? { depot_id: fx.main } : name === "get_security" ? { security_id: fx.sap } : {};
    const result = (await plain.callTool({ name, arguments: args })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual(DENIED);
    await plain.close();
  });

  it("never reaches the body", async () => {
    const body = vi.fn(async () => ({ content: [] }));
    await requirePortfolioRead(context(["watchlist"]), body)({});
    expect(body).not.toHaveBeenCalled();
  });
});

describe("tool list", () => {
  it("registers the nine read tools, each read-only, with or without the scope", async () => {
    for (const scopes of [["watchlist"], ["watchlist", "portfolio:read"]]) {
      const listing = await client(scopes);
      const { tools } = await listing.listTools();
      for (const name of PORTFOLIO_TOOL_NAMES) expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(true);
      await listing.close();
    }
  });

  it("never logs payload values", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn")];
    for (const name of PORTFOLIO_TOOL_NAMES) await call(name, name === "get_depot" ? { depot_id: fx.main } : name === "get_security" ? { security_id: fx.sap } : {});
    expect(logs.flatMap((spy) => spy.mock.calls)).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });
});
