// onvista (unofficial JSON API): daily EUR closes of certificates by ISIN (AD-9). Only the ISIN and
// onvista's instrument id plus the start date leave the server (AD-13).
import { z } from "zod";
import { businessDate } from "@/core/dates";
import { canonicalDecimal } from "@/core/decimal";
import { type FetchLike, getJson, latestClose, sortedCloses } from "./shared";
import type { DailyClose, PriceAdapter, PriceFetch } from "./types";

export const ONVISTA_API_URL = "https://api.onvista.de/api/v1/instruments";

const ENTITY_TYPE = /^[A-Z_]+$/;
const ENTITY_VALUE = /^\d+$/;

const querySchema = z
  .object({
    list: z.array(z.object({ isin: z.string().optional(), entityType: z.string().optional(), entityValue: z.string().optional() }).loose()),
  })
  .loose();

const eodSchema = z
  .object({ isoCurrency: z.string(), datetimeLast: z.array(z.number()), last: z.array(z.number()) })
  .loose()
  .refine((eod) => eod.datetimeLast.length === eod.last.length);

/**
 * onvista price adapter (symbol = ISIN): finds the instrument by ISIN, then reads its end-of-day
 * history on onvista's default listing. Only EUR listings are accepted; closes are dated by the
 * Europe/Berlin date of their timestamp (the last of a date wins) and limited to the requested range.
 */
export function onvistaPrices({ fetch, now = () => new Date() }: { fetch: FetchLike; now?: () => Date }): PriceAdapter {
  async function fetchHistory(symbol: string, from: string, to: string): Promise<PriceFetch<DailyClose[]>> {
    const query = await getJson(fetch, `${ONVISTA_API_URL}/query?searchValue=${encodeURIComponent(symbol)}`);
    if (!query) return { ok: false, reason: "network" };
    if (query.status === 404) return { ok: false, reason: "not-found" };
    if (!query.ok) return { ok: false, reason: "network" };
    const parsedQuery = querySchema.safeParse(query.body);
    if (!parsedQuery.success) return { ok: false, reason: "schema" };
    const wanted = symbol.trim().toUpperCase();
    const instrument = parsedQuery.data.list.find(
      (entry) =>
        entry.isin?.trim().toUpperCase() === wanted &&
        ENTITY_TYPE.test(entry.entityType ?? "") &&
        ENTITY_VALUE.test(entry.entityValue ?? ""),
    );
    if (!instrument) return { ok: false, reason: "not-found" };

    const eod = await getJson(
      fetch,
      `${ONVISTA_API_URL}/${instrument.entityType}/${instrument.entityValue}/eod_history?range=MAX&startDate=${from}`,
    );
    if (!eod) return { ok: false, reason: "network" };
    if (eod.status === 404) return { ok: false, reason: "not-found" };
    if (!eod.ok) return { ok: false, reason: "network" };
    const parsed = eodSchema.safeParse(eod.body);
    if (!parsed.success) return { ok: false, reason: "schema" };
    if (parsed.data.isoCurrency !== "EUR") return { ok: false, reason: "currency" };
    try {
      const byDate = new Map<string, string>();
      parsed.data.datetimeLast.forEach((seconds, index) => {
        const close = parsed.data.last[index];
        if (!(close > 0)) return;
        const date = businessDate(new Date(seconds * 1000));
        if (date < from || date > to) return;
        byDate.set(date, canonicalDecimal(String(close)));
      });
      if (byDate.size === 0) return { ok: false, reason: "not-found" };
      return { ok: true, value: sortedCloses(byDate) };
    } catch {
      return { ok: false, reason: "unexpected" };
    }
  }

  return {
    fetchHistory: (symbol, from, to) => fetchHistory(symbol, from, to),
    fetchLatest: (symbol) => latestClose((from, to) => fetchHistory(symbol, from, to), now),
  };
}
