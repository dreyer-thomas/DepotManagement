// Shared bits of the provider adapters. Expected failures are typed results, never thrown.

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
