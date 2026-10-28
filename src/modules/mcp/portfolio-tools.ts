// Portfolio read tools (Epic 10, scope `portfolio:read`). Registered for every grant so a client without the
// scope gets the specific refusal instead of "unknown tool"; each tool checks the scope at call time through
// `requirePortfolioRead` and then calls the same exported module services and core functions the pages use
// (story 10.2): no figure is computed here. Read-only; amounts are EUR decimal strings, dates `YYYY-MM-DD`;
// payload values are never logged.
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BENCHMARK_KEYS, BENCHMARKS } from "@/core/benchmarks";
import { type Classification, type ClassifiedAssetType, DIMENSIONS, effective } from "@/core/classification";
import { holdingShares, holdingTotals } from "@/core/composition";
import { isBusinessDate, lastPerMonth } from "@/core/dates";
import { dividendAnalysis } from "@/core/dividend-analysis";
import { gainsAnalysis } from "@/core/gains-analysis";
import { DEFAULT_PERIOD, parsePeriod, type PeriodSelection, resolvePeriod, serializePeriod } from "@/core/period";
import { isStale } from "@/core/prices";
import {
  ALLOCATION_DIMENSIONS,
  type AllocationDimension,
  allocationAnalysis,
  listClassifications,
  listKeyFigures,
} from "@/modules/classification";
import {
  benchmarkLines,
  type DepotSummary,
  depotValuation,
  dividendAnalysisInput,
  gainsInput,
  getDepot,
  getSecurity,
  listDepots,
  listHeldSecurities,
  listPositions,
  type PeriodPerformance,
  portfolioValuation,
  queryTransactions,
  type SecuritySummary,
  securityDetail,
  TRANSACTION_QUERY_MAX_LIMIT,
  TRANSACTION_TYPES,
  type TransactionRecord,
  valuationSummary,
  type ValuationSummary,
} from "@/modules/ledger";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";
import { PORTFOLIO_READ_SCOPE } from "./authorize";
import { guarded, type Handler, keyFiguresPayload, type McpToolContext, refusal, result } from "./tools";

export const PORTFOLIO_TOOL_NAMES = [
  "get_portfolio_summary",
  "list_depots",
  "get_depot",
  "list_positions",
  "list_transactions",
  "get_performance",
  "get_allocation",
  "get_income",
  "get_security",
] as const;

export const PORTFOLIO_READ_DENIED_MESSAGE = "Keine Berechtigung für Depotdaten";

/** Default page size of `list_transactions`. */
export const TRANSACTION_PAGE_DEFAULT = 100;

function denied(): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "portfolio-read-required", message: PORTFOLIO_READ_DENIED_MESSAGE }) }] };
}

/** Call-time scope gate: without `portfolio:read` the body (and every service) is never reached. */
export function requirePortfolioRead<A>(ctx: McpToolContext, body: Handler<A>): Handler<A> {
  return async (args) => (ctx.scopes.includes(PORTFOLIO_READ_SCOPE) ? body(args) : denied());
}

/** Price loaders bound to the request's DB: the full stored history (valuations) and the latest stored Prices (Positions). */
function priceLoaders(ctx: McpToolContext) {
  return {
    history: { storedPrices: (ids: string[], asOf: string) => storedPriceHistory(ids, asOf, ctx.db) },
    latest: { storedPrices: (ids: string[], asOf: string) => latestStoredPrices(ids, asOf, ctx.db) },
  };
}

/** The `period` argument: absent → `DEFAULT_PERIOD` (1J); `null` when it does not parse. */
function selectionOf(period: string | undefined, today: string): PeriodSelection | null {
  return period === undefined ? DEFAULT_PERIOD : parsePeriod(period, today);
}

function depotPayload(depot: DepotSummary) {
  return { id: depot.id, name: depot.name, broker: depot.broker, archived: depot.archived, cash_balance: depot.cashBalance };
}

function securityPayload(security: SecuritySummary) {
  return { id: security.id, name: security.name, isin: security.isin, crypto_symbol: security.cryptoSymbol, asset_type: security.assetType };
}

function performancePayload(performance: PeriodPerformance) {
  return {
    gain: performance.gain,
    realized: performance.realized,
    unrealized: performance.unrealized,
    dividends: performance.dividends,
    fees: performance.fees,
    taxes: performance.taxesPaid,
    ttwror: performance.ttwror,
    xirr: performance.xirr,
  };
}

/** The headline figures of a valuation (Overview / Depot hero). */
function summaryPayload(summary: ValuationSummary) {
  return {
    from: summary.from,
    to: summary.to,
    value: summary.value,
    invested_capital: summary.investedCapital,
    cash: summary.cash,
    ...performancePayload(summary.performance),
    dividends: summary.dividends,
    taxes: summary.taxesPaid,
  };
}

const NULL_SUMMARY = {
  value: null,
  invested_capital: null,
  cash: null,
  gain: null,
  realized: null,
  unrealized: null,
  dividends: null,
  fees: null,
  taxes: null,
  ttwror: null,
  xirr: null,
};

function transactionPayload(row: TransactionRecord) {
  return {
    id: row.id,
    depot_id: row.depotId,
    date: row.date,
    sequence: row.sequence,
    type: row.type,
    security: row.security ? securityPayload(row.security) : null,
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    fee: row.fee,
    tax: row.tax,
    note: row.note,
  };
}

const DIMENSION_KEYS: Record<(typeof DIMENSIONS)[number], string> = {
  assetClass: "asset_class",
  sector: "sector",
  industry: "industry",
  region: "region",
  country: "country",
  companySize: "company_size",
  currency: "currency",
};

function classificationPayload(classification: Classification) {
  return {
    type: classification.type,
    ...Object.fromEntries(
      DIMENSIONS.map((dimension) => [DIMENSION_KEYS[dimension], { value: classification[dimension].value, source: classification[dimension].source }]),
    ),
  };
}

const optionalId = (what: string) => z.string().optional().describe(`The ${what} id (from list_depots / list_positions / search_securities).`);
const periodArg = z
  .string()
  .optional()
  .describe("Period: 1T, 1W, 1M, YTD, 1J, 3J, MAX or custom:YYYY-MM-DD:YYYY-MM-DD (to not after today); default 1J.");
const dateArg = z.string().refine(isBusinessDate, "A valid date YYYY-MM-DD.");
const UNITS =
  "Amounts and quantities are decimal strings (EUR); ratios are plain decimals (0.05 = 5 %); TTWROR is not annualised, XIRR is annualised; null = not available.";

/** Registers the portfolio read tools on `server`, each gated by `portfolio:read` at call time. */
export function registerPortfolioTools(server: McpServer, ctx: McpToolContext): void {
  const prices = priceLoaders(ctx);
  const register = <S extends z.ZodRawShape>(
    name: (typeof PORTFOLIO_TOOL_NAMES)[number],
    description: string,
    inputSchema: S,
    body: Handler<z.infer<z.ZodObject<S>>>,
  ) =>
    server.registerTool(
      name,
      { description: `${description} ${UNITS} Needs the Depotdaten permission.`, inputSchema, annotations: { readOnlyHint: true } },
      // `z.infer` of the shape is what the SDK passes (`ShapeOutput<S>`); TS cannot resolve that conditional for a generic S.
      guarded(name, requirePortfolioRead(ctx, body)) as unknown as ToolCallback<S>,
    );

  register(
    "get_portfolio_summary",
    "Portfolio (all non-archived Depots) figures for a Period, as the Overview shows them: value, invested capital and cash at the Period end; Period gain with realized/unrealized/dividends/fees split, net taxes, TTWROR, XIRR; and per non-archived Depot its value, gain, TTWROR and XIRR.",
    { period: periodArg },
    async ({ period }) => {
      const selection = selectionOf(period, ctx.today);
      if (selection === null) return refusal("period-invalid");
      const portfolio = await portfolioValuation(selection, ctx.today, ctx.db, prices.history);
      return result({
        period: serializePeriod(selection),
        ...summaryPayload(valuationSummary(portfolio)),
        has_transactions: portfolio.hasTransactions,
        depots: portfolio.depots.map(({ id, name, valuation }) => ({
          id,
          name,
          value: valuation.series.at(-1)?.value ?? "0",
          gain: valuation.performance.gain,
          ttwror: valuation.performance.ttwror,
          xirr: valuation.performance.xirr,
        })),
      });
    },
  );

  server.registerTool(
    "list_depots",
    {
      description:
        `Lists all Depots (archived ones included, sorted by name) with broker and Cash Account balance. ${UNITS} Needs the Depotdaten permission.`,
      annotations: { readOnlyHint: true },
    },
    guarded(
      "list_depots",
      requirePortfolioRead(ctx, async () => result({ depots: (await listDepots(ctx.db)).map(depotPayload) })),
    ),
  );

  register(
    "get_depot",
    "One Depot (archived ones too) with broker, archived flag and Cash Account balance, plus its Period figures as the Depot page shows them (value, invested capital, cash, gain split, net taxes, TTWROR, XIRR). Without Transactions the figures are null and has_transactions is false.",
    { depot_id: z.string().describe("The Depot id (from list_depots)."), period: periodArg },
    async ({ depot_id, period }) => {
      const selection = selectionOf(period, ctx.today);
      if (selection === null) return refusal("period-invalid");
      const depot = await getDepot(depot_id, ctx.db);
      if (!depot) return refusal("depot-not-found");
      const base = { ...depotPayload(depot), period: serializePeriod(selection) };
      if (depot.transactionCount === 0) {
        return result({ ...base, ...resolvePeriod(selection, ctx.today, null), ...NULL_SUMMARY, has_transactions: false });
      }
      const valuation = await depotValuation(depot.id, selection, ctx.today, ctx.db, prices.history);
      return result({ ...base, ...summaryPayload(valuationSummary(valuation)), has_transactions: true });
    },
  );

  register(
    "list_positions",
    "Open Positions as of today, one row per Depot and Security, as the Positions tab shows them: quantity (split-adjusted), latest price with its date and stale flag, value, Cost Basis (FIFO, fees included), average price, unrealized gain and gain ratio, and share = value / (all listed Positions' values + cash). Unpriced Positions have null price-dependent fields. Without depot_id: every non-archived Depot; a depot_id may name an archived Depot. Also returns positions_value and cash of the scope.",
    { depot_id: optionalId("Depot") },
    async ({ depot_id }) => {
      let depots: DepotSummary[];
      if (depot_id !== undefined) {
        const depot = await getDepot(depot_id, ctx.db);
        if (!depot) return refusal("depot-not-found");
        depots = [depot];
      } else {
        depots = (await listDepots(ctx.db)).filter((depot) => !depot.archived);
      }
      const positionsByDepot = await Promise.all(depots.map((depot) => listPositions(depot.id, ctx.today, ctx.db, prices.latest)));
      const rows = depots.flatMap((depot, index) => positionsByDepot[index].map((position) => ({ depot, position })));
      const values = rows.map(({ position }) => position.value);
      const cash = depots.map((depot) => depot.cashBalance);
      const shares = holdingShares(values, cash);
      const totals = holdingTotals(values, cash);
      return result({
        as_of: ctx.today,
        positions: rows.map(({ depot, position }, index) => ({
          depot_id: depot.id,
          depot_name: depot.name,
          security: securityPayload(position.security),
          quantity: position.quantity,
          price: position.price,
          price_date: position.priceDate,
          stale: position.priceDate === null ? false : isStale(position.priceDate, ctx.today),
          value: position.value,
          cost_basis: position.costBasis,
          average_price: position.averagePrice,
          gain: position.gain,
          gain_ratio: position.gainRatio,
          share: shares[index],
        })),
        positions_value: totals.positionsValue,
        cash: totals.cash,
      });
    },
  );

  register(
    "list_transactions",
    `Ledger Transactions newest first (date, sequence, id descending), each with its depot_id and Security; quantities and prices as booked (not split-adjusted). Filters: depot_id (default every Depot, archived included), from/to (inclusive dates), types, security_id. Paged: limit 1..${TRANSACTION_QUERY_MAX_LIMIT} (default ${TRANSACTION_PAGE_DEFAULT}); pass next_cursor as cursor for the next page (null = last page), with the same filters as the call that returned it.`,
    {
      depot_id: optionalId("Depot"),
      from: dateArg.optional().describe("First date, YYYY-MM-DD."),
      to: dateArg.optional().describe("Last date, YYYY-MM-DD."),
      types: z.array(z.enum(TRANSACTION_TYPES)).optional(),
      security_id: optionalId("Security"),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(TRANSACTION_QUERY_MAX_LIMIT).optional(),
    },
    async ({ depot_id, from, to, types, security_id, cursor, limit }) => {
      if (depot_id !== undefined && !(await getDepot(depot_id, ctx.db))) return refusal("depot-not-found");
      if (security_id !== undefined && !(await getSecurity(security_id, ctx.db))) return refusal("security-not-found");
      const page = await queryTransactions(
        { depotId: depot_id, from, to, types, securityId: security_id, cursor, limit: limit ?? TRANSACTION_PAGE_DEFAULT },
        ctx.db,
      );
      if (!page.ok) return refusal(page.reason);
      return result({ transactions: page.rows.map(transactionPayload), next_cursor: page.nextCursor });
    },
  );

  register(
    "get_performance",
    "Value and performance series of the Portfolio (non-archived Depots) or one Depot over a Period: points from the day before the Period start, each with value, invested capital and cumulative TTWROR since that start; interval month keeps each month's last point. Optional benchmark: the index ETF's price-return line on the same dates (null when no stored prices) and its Period return.",
    {
      depot_id: optionalId("Depot"),
      period: periodArg,
      interval: z.enum(["day", "month"]).optional().describe("day (default) or month."),
      benchmark: z.enum(BENCHMARK_KEYS).optional().describe(BENCHMARKS.map((b) => `${b.key} = ${b.label}`).join(", ")),
    },
    async ({ depot_id, period, interval, benchmark }) => {
      const selection = selectionOf(period, ctx.today);
      if (selection === null) return refusal("period-invalid");
      if (depot_id !== undefined && !(await getDepot(depot_id, ctx.db))) return refusal("depot-not-found");
      const valuation =
        depot_id !== undefined
          ? await depotValuation(depot_id, selection, ctx.today, ctx.db, prices.history)
          : await portfolioValuation(selection, ctx.today, ctx.db, prices.history);
      const sample = <T extends { date: string }>(points: readonly T[]): T[] => (interval === "month" ? lastPerMonth(points) : [...points]);
      const points = [valuation.start, ...valuation.series].map((point, index) => ({
        date: point.date,
        value: point.value,
        invested_capital: point.investedCapital,
        ttwror: valuation.performanceLine[index]?.performance ?? null,
      }));
      let benchmarkPayload = null;
      if (benchmark !== undefined) {
        const line = (await benchmarkLines(valuation.start.date, valuation.to, ctx.db, prices.history))[benchmark];
        const meta = BENCHMARKS.find((candidate) => candidate.key === benchmark)!;
        benchmarkPayload =
          line === null ? null : { key: meta.key, label: meta.label, ttwror: line.at(-1)?.performance ?? null, points: sample(line) };
      }
      return result({
        depot_id: depot_id ?? null,
        period: serializePeriod(selection),
        from: valuation.from,
        to: valuation.to,
        interval: interval ?? "day",
        ttwror: valuation.performance.ttwror,
        xirr: valuation.performance.xirr,
        points: sample(points),
        benchmark: benchmarkPayload,
      });
    },
  );

  register(
    "get_allocation",
    `Allocation as of today of the Portfolio (non-archived Depots) or one Depot by a classification dimension, as Analysen › Aufteilung shows it: segments (German labels; unclassified = "Unbekannt", cash = "Guthaben", last) with amount and share of the total incl. cash, each with its Positions (value, share, and weight = the fund's fraction in the segment when a fund is split by region). Dimensions: ${Object.entries(ALLOCATION_DIMENSIONS)
      .map(([key, label]) => `${key} (${label})`)
      .join(", ")}; default assetClass.`,
    {
      dimension: z.enum(Object.keys(ALLOCATION_DIMENSIONS) as [AllocationDimension, ...AllocationDimension[]]).optional(),
      depot_id: optionalId("Depot"),
    },
    async ({ dimension = "assetClass", depot_id }) => {
      if (depot_id !== undefined && !(await getDepot(depot_id, ctx.db))) return refusal("depot-not-found");
      const analysis = await allocationAnalysis(depot_id !== undefined ? { depotId: depot_id } : "portfolio", dimension, ctx.today, ctx.db, prices.latest);
      return result({
        as_of: ctx.today,
        depot_id: depot_id ?? null,
        dimension,
        dimension_label: ALLOCATION_DIMENSIONS[dimension],
        segments: analysis.segments.map((segment) => ({
          key: segment.key,
          kind: segment.kind,
          label: segment.label,
          amount: segment.amount,
          share: segment.share,
          positions: (analysis.positions[segment.key] ?? []).map((position) => ({
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
    },
  );

  register(
    "get_income",
    "Income and cash flows per month (YYYY-MM, first ledger month to today) or year of the Portfolio (non-archived Depots) or one Depot, as Analysen › Dividenden and › Gewinne show them: dividends gross and net (after the taxes booked on them), and gains with realized FIFO gains, gross dividends, fees, net taxes (paid minus refunds), deposits, withdrawals and net cash flow (deposits − withdrawals).",
    { depot_id: optionalId("Depot"), granularity: z.enum(["month", "year"]).optional().describe("month (default) or year.") },
    async ({ depot_id, granularity = "month" }) => {
      if (depot_id !== undefined && !(await getDepot(depot_id, ctx.db))) return refusal("depot-not-found");
      const scope = depot_id !== undefined ? { depotId: depot_id } : ("portfolio" as const);
      const [gainsIn, dividendsIn] = await Promise.all([gainsInput(scope, ctx.db), dividendAnalysisInput(scope, ctx.today, ctx.db, prices.latest)]);
      const gains = gainsAnalysis(gainsIn.depots, gainsIn.actions, ctx.today);
      const dividends = dividendAnalysis(dividendsIn.depots, dividendsIn.actions, ctx.today);
      const pick = <T,>(months: T[], years: T[]) => (granularity === "year" ? years : months);
      return result({
        depot_id: depot_id ?? null,
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
    },
  );

  register(
    "get_security",
    "One Security (held, sold or only watched) as its detail page shows it, over all non-archived booking Depots or one depot_id: held (open Position in a non-archived Depot), booked, latest price with date and stale flag (of price_security: the Security whose prices are used, which differs from security after an ISIN change), Period figures (value at the Period end, gain split, TTWROR, XIRR, price change), the holding snapshot (quantity, Cost Basis, value, unrealized, average price), all_time results since the first buy (realized, unrealized, dividends, fees, taxes_paid, total = realized + unrealized + dividends − fees, total_invested, return_ratio, XIRR, value), the effective classification and key_figures (Yahoo Finance snapshot, 52-week figures from stored closes, analyst ratings for stocks). Not investment advice.",
    { security_id: z.string().describe("The Security id (from list_positions or search_securities)."), depot_id: optionalId("Depot"), period: periodArg },
    async ({ security_id, depot_id, period }) => {
      const selection = selectionOf(period, ctx.today);
      if (selection === null) return refusal("period-invalid");
      if (depot_id !== undefined && !(await getDepot(depot_id, ctx.db))) return refusal("depot-not-found");
      const detail = await securityDetail(security_id, depot_id, selection, ctx.today, ctx.db, prices.history);
      if (!detail) return refusal("security-not-found");
      if (depot_id !== undefined && detail.selected !== depot_id) return refusal("security-not-in-depot");
      const { security } = detail;
      const [held, classifications, keyFigures] = await Promise.all([
        listHeldSecurities(ctx.today, ctx.db),
        listClassifications(ctx.db),
        listKeyFigures([security.id], ctx.today, ctx.db),
      ]);
      const classification = classifications[security.id] ?? effective(null, security.assetType as ClassifiedAssetType);
      const end = detail.series.at(-1) ?? detail.start;
      const { total, snapshot } = detail;
      return result({
        security: securityPayload(security),
        held: held.includes(security.id),
        booked: detail.depots.length > 0,
        depots: detail.depots.map((depot) => ({ id: depot.id, name: depot.name, archived: depot.archived })),
        selected_depot_id: detail.selected,
        period: serializePeriod(selection),
        from: detail.from,
        to: detail.to,
        price_security: securityPayload(detail.priceSecurity),
        price: detail.price?.price ?? null,
        price_date: detail.price?.date ?? null,
        price_source: detail.price?.source ?? null,
        stale: detail.price ? isStale(detail.price.date, ctx.today) : false,
        performance: {
          value: end.value,
          ...performancePayload(detail.performance),
          price_change: detail.priceChange ? { per_unit: detail.priceChange.perUnit, ratio: detail.priceChange.ratio } : null,
        },
        snapshot: {
          quantity: snapshot.quantity,
          cost_basis: snapshot.costBasis,
          value: snapshot.value,
          unrealized: snapshot.unrealized,
          average_price: snapshot.averagePrice,
        },
        all_time: {
          realized: total.realized,
          unrealized: total.unrealized,
          dividends: total.dividends,
          fees: total.fees,
          taxes_paid: total.taxesPaid,
          total: total.total,
          total_invested: total.totalInvested,
          return_ratio: total.returnRatio,
          xirr: total.xirr,
          value: total.value,
        },
        classification: classificationPayload(classification),
        key_figures: keyFiguresPayload(detail.fiftyTwoWeek, keyFigures[security.id]),
      });
    },
  );
}
