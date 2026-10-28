// The nine watchlist tools (story 9.4, scope `watchlist`). Thin adapters over the `watchlist` and `ledger`
// services and the `prices` OpenFIGI lookup: arguments go to the services unvalidated (so the app and Claude
// refuse the same inputs), reasons become `{ error, message }`. No figures are computed here; `held` is never
// part of a payload. Payload values are never logged. `get_watchlist` adds each entry's key figures (story
// 9.6: the classification module's snapshot plus the 52-week figures computed by core) and, for stocks,
// the analyst ratings (story 9.7).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { analystConsensusOf, analystCountOf, type AnalystRatings, consensusMean, targetChange } from "@/core/analyst-ratings";
import { emptyKeyFigures } from "@/core/key-figures";
import { WATCHLIST_NAME_MAX_LENGTH, WATCHLIST_NOTE_MAX_LENGTH } from "@/core/watchlist";
import { type KeyFiguresInfo, listKeyFigures } from "@/modules/classification";
import { type AssetType, findSecurity, listSecurities, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { IsinDetails, Lookup } from "@/modules/prices";
import {
  addWatchlistEntry,
  createWatchlist,
  deleteWatchlist,
  getWatchlist,
  listWatchlists,
  removeWatchlistEntry,
  renameWatchlist,
  updateWatchlistEntry,
  type WatchlistEntryView,
  type WatchlistSummary,
  watchlistView,
} from "@/modules/watchlist";
import { WATCHLIST_SCOPE } from "./authorize";
import type { McpDb } from "./clients";
import { inTransaction } from "./tokens";

export const WATCHLIST_TOOL_NAMES = [
  "list_watchlists",
  "get_watchlist",
  "create_watchlist",
  "rename_watchlist",
  "delete_watchlist",
  "add_watchlist_entry",
  "update_watchlist_entry",
  "remove_watchlist_entry",
  "search_securities",
] as const;

export const SEARCH_RESULT_LIMIT = 20;

/** What the tools need from the request: DB, today, the connected client and app-layer callbacks. */
export type McpToolContext = {
  db: McpDb;
  /** Business date `YYYY-MM-DD` (Europe/Berlin) of the request. */
  today: string;
  /** Scopes of the grant; the watchlist tools are registered only with `watchlist`. */
  scopes: readonly string[];
  /** Name of the connected client, recorded on entries it adds ("via Claude"). */
  clientName: string;
  lookupIsin: (isin: string) => Promise<Lookup<IsinDetails>>;
  /** After a successful write: revalidate watchlist/Security pages; `backfill` schedules the price backfill. */
  onWatchlistChange: (change: { backfill: boolean }) => void;
};

const MESSAGES: Record<string, string> = {
  "name-empty": "Der Name darf nicht leer sein.",
  "name-too-long": `Der Name darf höchstens ${WATCHLIST_NAME_MAX_LENGTH} Zeichen lang sein.`,
  "name-taken": "Es gibt schon eine Watchlist mit diesem Namen.",
  "watchlist-not-found": "Diese Watchlist gibt es nicht.",
  "entry-not-found": "Diesen Eintrag gibt es nicht.",
  "security-not-found": "Dieses Wertpapier gibt es nicht.",
  "already-on-list": "Steht schon auf dieser Liste.",
  "note-too-long": `Die Notiz darf höchstens ${WATCHLIST_NOTE_MAX_LENGTH} Zeichen lang sein.`,
  "date-invalid": "Das Datum muss im Format JJJJ-MM-TT angegeben werden und darf nicht in der Zukunft liegen.",
  "isin-invalid": "Die ISIN ist ungültig.",
  "crypto-symbol-invalid": "Das Krypto-Symbol ist ungültig (1–10 Buchstaben oder Ziffern, z. B. BTC).",
  "security-name-invalid": `Der Name des Wertpapiers muss 1 bis ${SECURITY_NAME_MAX_LENGTH} Zeichen lang sein.`,
  "asset-type-invalid": "Die Wertpapierart passt nicht zur Kennung.",
  "identifier-invalid": "Gib genau eines an: eine ISIN oder ein Krypto-Symbol.",
  "isin-not-found": "Zu dieser ISIN wurde kein Wertpapier gefunden.",
  "isin-lookup-failed": "Die ISIN konnte gerade nicht nachgeschlagen werden. Bitte später erneut versuchen.",
  "asset-type-unknown": "Die Wertpapierart zu dieser ISIN ist unbekannt; lege das Wertpapier in der App an.",
  "confirm-name-mismatch": "Die Watchlist enthält Einträge. Zum Löschen confirm_name mit dem genauen Namen der Liste angeben.",
  "query-empty": "Der Suchbegriff darf nicht leer sein.",
  "internal-error": "Das hat nicht geklappt. Bitte später erneut versuchen.",
};

export function result(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function refusal(reason: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: reason, message: MESSAGES[reason] ?? MESSAGES["internal-error"] }) }] };
}

const FIGI_TYPES: ReadonlyArray<[AssetType, readonly string[]]> = [
  ["STOCK", ["common stock", "adr", "gdr", "reit", "preference"]],
  ["FUND", ["open-end fund", "closed-end fund", "fund of funds", "mutual fund"]],
  ["CERTIFICATE", ["warrant", "structured product", "certificate", "index warrant"]],
];

/**
 * Asset type of an OpenFIGI instrument: `ETP` → ETF (also when the other type names a fund); then the
 * first of `securityType`, `securityType2` matching the STOCK / FUND / CERTIFICATE lists (case-insensitive).
 * Null when nothing matches (`asset-type-unknown`). Pure.
 */
export function assetTypeFromFigi(details: Pick<IsinDetails, "securityType" | "securityType2">): AssetType | null {
  const types = [details.securityType, details.securityType2].map((type) => type?.trim().toLowerCase() ?? "");
  if (types.includes("etp")) return "ETF";
  for (const type of types) {
    const match = FIGI_TYPES.find(([, names]) => names.includes(type));
    if (match) return match[0];
  }
  return null;
}

function summaryPayload(list: WatchlistSummary) {
  return { id: list.id, name: list.name, entry_count: list.entryCount };
}

/** The analyst ratings of a stock's snapshot (story 9.7, snake_case); `null` without analyst data. */
export function analystsPayload(symbol: string | null, ratings: AnalystRatings | null) {
  if (ratings === null) return null;
  return {
    symbol,
    consensus: analystConsensusOf(ratings),
    consensus_mean: consensusMean(ratings),
    analyst_count: analystCountOf(ratings),
    trend: ratings.trend.map((month) => ({
      period: month.period,
      strong_buy: month.strongBuy,
      buy: month.buy,
      hold: month.hold,
      sell: month.sell,
      strong_sell: month.strongSell,
    })),
    price_target: {
      low: ratings.target.low,
      mean: ratings.target.mean,
      median: ratings.target.median,
      high: ratings.target.high,
      currency: ratings.target.currency,
      current_price: ratings.target.currentPrice,
      implied_change: targetChange(ratings.target),
    },
    recent_changes: ratings.changes.map((change) => ({
      date: change.date,
      firm: change.firm,
      from_grade: change.fromGrade,
      to_grade: change.toGrade,
      action: change.action,
      price_target_from: change.priceTargetFrom,
      price_target_to: change.priceTargetTo,
    })),
  };
}

/**
 * The key figures of an entry (snake_case, decimals as strings or null, dates `YYYY-MM-DD`): the provider
 * snapshot with `as_of` / `stale` (all null without one) and the 52-week figures from the stored closes.
 */
export function keyFiguresPayload(entry: WatchlistEntryView, info: KeyFiguresInfo | undefined) {
  const snapshot = info?.snapshot ?? null;
  const figures = snapshot?.figures ?? emptyKeyFigures();
  const week = entry.fiftyTwoWeek;
  return {
    source: "Yahoo Finance",
    as_of: snapshot?.asOf ?? null,
    stale: snapshot?.stale ?? false,
    trailing_pe: figures.trailingPE,
    forward_pe: figures.forwardPE,
    price_to_book: figures.priceToBook,
    price_to_sales: figures.priceToSales,
    peg_ratio: figures.pegRatio,
    market_cap: figures.marketCap,
    market_cap_currency: figures.marketCapCurrency,
    revenue: figures.revenue,
    revenue_currency: figures.revenueCurrency,
    dividend_yield: figures.dividendYield,
    payout_ratio: figures.payoutRatio,
    ex_dividend_date: figures.exDividendDate,
    profit_margin: figures.profitMargin,
    return_on_equity: figures.returnOnEquity,
    revenue_growth: figures.revenueGrowth,
    debt_to_equity_percent: figures.debtToEquity,
    beta: figures.beta,
    next_earnings_date: figures.nextEarningsDate,
    fund_family: figures.fundFamily,
    expense_ratio: figures.expenseRatio,
    inception_date: figures.inceptionDate,
    fifty_two_week: {
      basis: "closing prices",
      high: week.high?.price ?? null,
      high_date: week.high?.date ?? null,
      low: week.low?.price ?? null,
      low_date: week.low?.date ?? null,
      distance_to_high: week.distanceToHigh,
      performance: week.performance,
    },
    analysts: analystsPayload(snapshot?.analystSymbol ?? null, snapshot?.analysts ?? null),
  };
}

/**
 * An entry as the tools return it (snake_case, decimals as strings, never `held`); with `keyFigures`
 * (from `listKeyFigures`) it also carries `key_figures`.
 */
export function entryPayload(entry: WatchlistEntryView, keyFigures?: Readonly<Record<string, KeyFiguresInfo>>) {
  return {
    id: entry.id,
    security_id: entry.securityId,
    name: entry.security.name,
    isin: entry.security.isin,
    crypto_symbol: entry.security.cryptoSymbol,
    asset_type: entry.security.assetType,
    note: entry.note,
    date_added: entry.dateAdded,
    price: entry.price,
    price_date: entry.priceDate,
    stale: entry.stale,
    change_today: entry.changeToday ? { per_unit: entry.changeToday.perUnit, ratio: entry.changeToday.ratio } : null,
    change_since_added: entry.sinceAdded,
    source: entry.source,
    client_name: entry.clientName,
    ...(keyFigures ? { key_figures: keyFiguresPayload(entry, keyFigures[entry.securityId]) } : {}),
  };
}

async function entryById(ctx: McpToolContext, entryId: string) {
  const lists = await watchlistView(ctx.today, ctx.db);
  for (const list of lists) {
    const entry = list.entries.find((candidate) => candidate.id === entryId);
    if (entry) return entryPayload(entry);
  }
  return null;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** The `security` input of `addWatchlistEntry`: an existing Security, or a new one (OpenFIGI for an ISIN). */
async function resolveSecurity(
  args: { isin?: string; crypto_symbol?: string; name?: string },
  ctx: McpToolContext,
): Promise<{ ok: true; security: Parameters<typeof addWatchlistEntry>[0]["security"] } | { ok: false; reason: string }> {
  const isin = nonEmpty(args.isin);
  const symbol = nonEmpty(args.crypto_symbol);
  if ((isin === undefined) === (symbol === undefined)) return { ok: false, reason: "identifier-invalid" };
  const name = nonEmpty(args.name);
  if (symbol !== undefined) {
    const found = await findSecurity({ cryptoSymbol: symbol }, ctx.db);
    if (!found.ok) return found;
    if (found.security) return { ok: true, security: { id: found.security.id } };
    return { ok: true, security: { new: { cryptoSymbol: symbol, name: name ?? symbol.trim().toUpperCase(), assetType: "CRYPTO" } } };
  }
  const found = await findSecurity({ isin }, ctx.db);
  if (!found.ok) return found;
  if (found.security) return { ok: true, security: { id: found.security.id } };
  const normalized = isin!.trim().toUpperCase();
  const lookup = await ctx.lookupIsin(normalized);
  if (lookup.status === "not-found") return { ok: false, reason: "isin-not-found" };
  if (lookup.status === "error") return { ok: false, reason: "isin-lookup-failed" };
  const assetType = assetTypeFromFigi(lookup.value);
  if (assetType === null) return { ok: false, reason: "asset-type-unknown" };
  const securityName = (name ?? lookup.value.name).normalize("NFC").trim().slice(0, SECURITY_NAME_MAX_LENGTH);
  return { ok: true, security: { new: { isin: normalized, name: securityName, assetType } } };
}

/** Case-insensitive substring search over name, ISIN and crypto symbol; ≤ 20 Securities by name. Pure. */
export function matchSecurities<T extends { name: string; isin: string | null; cryptoSymbol: string | null }>(
  securities: readonly T[],
  query: string,
): T[] {
  const needle = query.normalize("NFC").trim().toLocaleLowerCase("de-DE");
  return securities
    .filter((security) =>
      [security.name, security.isin ?? "", security.cryptoSymbol ?? ""].some((value) =>
        value.normalize("NFC").toLocaleLowerCase("de-DE").includes(needle),
      ),
    )
    .slice(0, SEARCH_RESULT_LIMIT);
}

export type Handler<A> = (args: A) => Promise<CallToolResult>;

/** Wraps a tool body: unexpected failures are logged by error name only and become `internal-error`. */
export function guarded<A>(tool: string, body: Handler<A>): Handler<A> {
  return async (args) => {
    try {
      return await body(args);
    } catch (error) {
      console.error(`MCP: tool ${tool} failed (${error instanceof Error ? error.name : "unknown"})`);
      return refusal("internal-error");
    }
  };
}

const id = (what: string) => z.string().describe(`The ${what} id.`);
const dateAdded = z.string().describe("Date added, YYYY-MM-DD, not in the future; default today.");
const note = z.string().describe(`Plain-text note, at most ${WATCHLIST_NOTE_MAX_LENGTH} characters.`);

/** Registers the watchlist tools on `server` when the grant holds the `watchlist` scope. */
export function registerWatchlistTools(server: McpServer, ctx: McpToolContext): void {
  if (!ctx.scopes.includes(WATCHLIST_SCOPE)) return;

  server.registerTool(
    "list_watchlists",
    { description: "Lists all watchlists in creation order with their entry counts.", annotations: { readOnlyHint: true } },
    guarded("list_watchlists", async () => result((await listWatchlists(ctx.db)).map(summaryPayload))),
  );

  server.registerTool(
    "get_watchlist",
    {
      description:
        "Returns one watchlist with its entries: Security, note, date added, latest price (EUR, decimal string), price date, stale flag, change today and change since added (ratios), and key_figures: Yahoo Finance figures as of `as_of` (null when not delivered; `stale` when older than 7 days; ratios as plain decimals, e.g. dividend_yield 0.0118 = 1.18 %, debt_to_equity_percent in percent units; amounts with their currency) plus fifty_two_week high/low (with dates), distance to high and 52-week performance computed from stored closing prices, and for stocks `analysts` (null without analyst data): the Yahoo listing `symbol` it comes from, consensus (optimistic ≤ 2.0 < neutral ≤ 3.0 < pessimistic on the 1 = strong buy … 5 = strong sell mean), consensus_mean, analyst_count, the monthly recommendation trend (oldest first, period \"0m\" = current month), price_target in that listing's currency (never converted) with implied_change versus its current price (ratio), and recent_changes (up to 10 up-/downgrades, newest first). Not investment advice.",
      inputSchema: { watchlist_id: id("watchlist") },
      annotations: { readOnlyHint: true },
    },
    guarded("get_watchlist", async ({ watchlist_id }) => {
      const list = (await watchlistView(ctx.today, ctx.db)).find((candidate) => candidate.id === watchlist_id);
      if (!list) return refusal("watchlist-not-found");
      const keyFigures = await listKeyFigures(
        list.entries.map((entry) => entry.securityId),
        ctx.today,
        ctx.db,
      );
      return result({ id: list.id, name: list.name, entries: list.entries.map((entry) => entryPayload(entry, keyFigures)) });
    }),
  );

  server.registerTool(
    "create_watchlist",
    { description: `Creates a watchlist (name unique ignoring case, at most ${WATCHLIST_NAME_MAX_LENGTH} characters).`, inputSchema: { name: z.string() } },
    guarded("create_watchlist", async ({ name }) => {
      const created = await createWatchlist({ name }, ctx.db);
      if (!created.ok) return refusal(created.reason);
      ctx.onWatchlistChange({ backfill: false });
      return result(summaryPayload(created.watchlist));
    }),
  );

  server.registerTool(
    "rename_watchlist",
    { description: "Renames a watchlist.", inputSchema: { watchlist_id: id("watchlist"), name: z.string() } },
    guarded("rename_watchlist", async ({ watchlist_id, name }) => {
      const renamed = await renameWatchlist(watchlist_id, { name }, ctx.db);
      if (!renamed.ok) return refusal(renamed.reason === "not-found" ? "watchlist-not-found" : renamed.reason);
      ctx.onWatchlistChange({ backfill: false });
      return result(summaryPayload(renamed.watchlist));
    }),
  );

  server.registerTool(
    "delete_watchlist",
    {
      description:
        "Deletes a watchlist with its entries (Securities and prices stay). A list with entries is deleted only when confirm_name equals its name exactly.",
      inputSchema: { watchlist_id: id("watchlist"), confirm_name: z.string().optional() },
      annotations: { destructiveHint: true },
    },
    guarded("delete_watchlist", async ({ watchlist_id, confirm_name }) => {
      const outcome = await inTransaction(ctx.db, async (tx) => {
        const list = await getWatchlist(watchlist_id, tx);
        if (!list) return { ok: false as const, reason: "watchlist-not-found" };
        if (list.entryCount > 0 && confirm_name !== list.name) return { ok: false as const, reason: "confirm-name-mismatch" };
        const deleted = await deleteWatchlist(list.id, tx);
        if (!deleted.ok) return { ok: false as const, reason: "watchlist-not-found" };
        return { ok: true as const, list, entries: deleted.deleted.entries };
      });
      if (!outcome.ok) return refusal(outcome.reason);
      ctx.onWatchlistChange({ backfill: false });
      return result({ deleted: true, id: outcome.list.id, name: outcome.list.name, entries_deleted: outcome.entries });
    }),
  );

  server.registerTool(
    "add_watchlist_entry",
    {
      description:
        "Adds a Security to a watchlist by exactly one of isin or crypto_symbol. A known Security is used as is; an unknown ISIN is looked up at OpenFIGI (name overrides the found name), an unknown crypto symbol becomes a crypto Security named name or the symbol.",
      inputSchema: {
        watchlist_id: id("watchlist"),
        isin: z.string().optional(),
        crypto_symbol: z.string().optional().describe("Base symbol, e.g. BTC."),
        name: z.string().optional(),
        note: note.optional(),
        date_added: dateAdded.optional(),
      },
    },
    guarded("add_watchlist_entry", async (args) => {
      if (!(await getWatchlist(args.watchlist_id, ctx.db))) return refusal("watchlist-not-found");
      const security = await resolveSecurity(args, ctx);
      if (!security.ok) return refusal(security.reason);
      const added = await addWatchlistEntry(
        {
          watchlistId: args.watchlist_id,
          security: security.security,
          note: args.note,
          dateAdded: args.date_added,
          origin: { source: "MCP", clientName: ctx.clientName },
        },
        ctx.today,
        ctx.db,
      );
      if (!added.ok) return refusal(added.reason);
      ctx.onWatchlistChange({ backfill: true });
      return result((await entryById(ctx, added.entry.id)) ?? { id: added.entry.id });
    }),
  );

  server.registerTool(
    "update_watchlist_entry",
    {
      description: "Changes an entry's note and/or date added, or moves it to another watchlist (watchlist_id). Omitted fields stay.",
      inputSchema: { entry_id: id("entry"), note: note.optional(), date_added: z.string().optional(), watchlist_id: z.string().optional() },
    },
    guarded("update_watchlist_entry", async ({ entry_id, note: newNote, date_added, watchlist_id }) => {
      const updated = await updateWatchlistEntry(
        entry_id,
        { note: newNote, dateAdded: date_added, ...(watchlist_id === undefined ? {} : { watchlistId: watchlist_id }) },
        ctx.today,
        ctx.db,
      );
      if (!updated.ok) return refusal(updated.reason === "not-found" ? "entry-not-found" : updated.reason);
      const moved = watchlist_id !== undefined;
      ctx.onWatchlistChange({ backfill: moved || updated.entry.dateAdded < updated.previousDateAdded });
      return result((await entryById(ctx, updated.entry.id)) ?? { id: updated.entry.id });
    }),
  );

  server.registerTool(
    "remove_watchlist_entry",
    { description: "Removes an entry from its watchlist; the Security and its prices stay.", inputSchema: { entry_id: id("entry") }, annotations: { destructiveHint: true } },
    guarded("remove_watchlist_entry", async ({ entry_id }) => {
      const removed = await removeWatchlistEntry(entry_id, ctx.db);
      if (!removed.ok) return refusal("entry-not-found");
      ctx.onWatchlistChange({ backfill: false });
      return result({ removed: true, id: entry_id });
    }),
  );

  server.registerTool(
    "search_securities",
    {
      description: "Searches the known Securities by name, ISIN or crypto symbol (case-insensitive substring); at most 20, sorted by name.",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    guarded("search_securities", async ({ query }) => {
      if (query.trim() === "") return refusal("query-empty");
      const matches = matchSecurities(await listSecurities(ctx.db), query);
      return result(
        matches.map((security) => ({
          id: security.id,
          name: security.name,
          isin: security.isin,
          crypto_symbol: security.cryptoSymbol,
          asset_type: security.assetType,
        })),
      );
    }),
  );
}
