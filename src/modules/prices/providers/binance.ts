// Binance public market data: daily EUR klines by `<SYMBOL>EUR`, used once to backfill crypto history
// older than CoinGecko's 365-day window (AD-9). Only the pair symbol and dates leave the server (AD-13).
import { z } from "zod";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "@/core/decimal";
import { DAY_MS, type FetchLike, getJson, latestClose, sortedCloses, utcDate, utcMidnight } from "./shared";
import type { DailyClose, PriceAdapter, PriceFetch } from "./types";

export const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";

/** Rows per klines page (Binance's maximum); a full page means there may be more. */
export const BINANCE_PAGE_SIZE = 1000;

const PAIR = /^[A-Z0-9]{1,20}EUR$/;

/** Binance's "Invalid symbol." error code. */
const INVALID_SYMBOL = -1121;

const klinesSchema = z.array(z.tuple([z.number(), z.unknown(), z.unknown(), z.unknown(), z.string()]).rest(z.unknown()));
const errorSchema = z.object({ code: z.number() }).loose();

/**
 * Binance price adapter (symbol = `<SYMBOL>EUR`): 1d klines from UTC midnight of `from` to UTC midnight
 * of `to`, each dated by the UTC date of its open time, paginated over full pages.
 */
export function binancePrices({ fetch, now = () => new Date() }: { fetch: FetchLike; now?: () => Date }): PriceAdapter {
  async function fetchHistory(symbol: string, from: string, to: string): Promise<PriceFetch<DailyClose[]>> {
    if (!PAIR.test(symbol)) return { ok: false, reason: "not-found" };
    const endTime = utcMidnight(to);
    const byDate = new Map<string, string>();
    let startTime = utcMidnight(from);
    for (;;) {
      const reply = await getJson(
        fetch,
        `${BINANCE_KLINES_URL}?symbol=${symbol}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=${BINANCE_PAGE_SIZE}`,
      );
      if (!reply) return { ok: false, reason: "network" };
      if (!reply.ok) {
        const error = errorSchema.safeParse(reply.body);
        if (reply.status === 400 && error.success && error.data.code === INVALID_SYMBOL) return { ok: false, reason: "not-found" };
        return { ok: false, reason: "network" };
      }
      const parsed = klinesSchema.safeParse(reply.body);
      if (!parsed.success) return { ok: false, reason: "schema" };
      try {
        for (const kline of parsed.data) {
          const close = kline[4];
          if (!isDecimalString(close) || !new ExactDecimal(close).greaterThan(0)) continue;
          const date = utcDate(kline[0]);
          if (date < from || date > to) continue;
          byDate.set(date, canonicalDecimal(close));
        }
      } catch {
        return { ok: false, reason: "unexpected" };
      }
      const page = parsed.data;
      if (page.length < BINANCE_PAGE_SIZE) break;
      const next = page[page.length - 1][0] + DAY_MS;
      if (next <= startTime || next > endTime) break;
      startTime = next;
    }
    if (byDate.size === 0) return { ok: false, reason: "not-found" };
    return { ok: true, value: sortedCloses(byDate) };
  }

  return {
    fetchHistory: (symbol, from, to) => fetchHistory(symbol, from, to),
    fetchLatest: (symbol) => latestClose((from, to) => fetchHistory(symbol, from, to), now),
  };
}
