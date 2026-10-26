// Shared bits of the provider adapters. Expected failures are typed results, never thrown.
import { addDays, businessDate } from "@/core/dates";
import type { DailyClose, PriceFetch } from "./types";

/** Timeout of every outbound provider request. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** `fetch` as injected into adapters (tests pass a fake serving recorded responses). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Result of a provider lookup: a value, a definitive miss, or a transient failure (retry later). */
export type Lookup<T> = { status: "found"; value: T } | { status: "not-found" } | { status: "error" };

export const NOT_FOUND = { status: "not-found" } as const;
export const ERROR = { status: "error" } as const;

/** An API key from the environment; empty or whitespace-only means unset. */
export function envKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Reads a JSON body; `undefined` when it is not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** A JSON GET: the HTTP status and parsed body, or `undefined` when the request itself failed (network). */
export async function getJson(
  fetch: FetchLike,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; ok: boolean; body: unknown } | undefined> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return { status: response.status, ok: response.ok, body: await readJson(response) };
  } catch {
    return undefined;
  }
}

/** Milliseconds of one calendar day. */
export const DAY_MS = 86_400_000;

/** The UTC calendar date `YYYY-MM-DD` of an epoch-milliseconds instant. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch milliseconds of UTC midnight of a `YYYY-MM-DD` date. */
export function utcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** Closes of a date → close map, ascending by date. */
export function sortedCloses(byDate: Map<string, string>): { date: string; close: string }[] {
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
}

/** `fetchLatest` of an adapter: the last close of the 7 days up to today (Europe/Berlin). */
export async function latestClose(
  fetchHistory: (from: string, to: string) => Promise<PriceFetch<DailyClose[]>>,
  now: () => Date,
): Promise<PriceFetch<DailyClose>> {
  const today = businessDate(now());
  const history = await fetchHistory(addDays(today, -7), today);
  return history.ok ? { ok: true, value: history.value[history.value.length - 1] } : history;
}
