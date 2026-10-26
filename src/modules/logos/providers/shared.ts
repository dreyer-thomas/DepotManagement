// Shared bits of the logo provider adapters (mirrors prices/providers/shared.ts; modules do not import
// each other's internals). Expected failures are typed results, never thrown. Logs name the provider and
// the HTTP status only — never a URL, key or identifier.
import { FETCH_MAX_BYTES, type LogoImage, sniffImage } from "../image";

/** Timeout of every outbound provider request. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** `fetch` as injected into adapters (tests pass a fake serving recorded responses). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Result of one logo lookup: an image, a definitive miss, or a transient failure (retry later). */
export type LogoLookup = { status: "found"; image: LogoImage } | { status: "not-found" } | { status: "error" };

export const NOT_FOUND = { status: "not-found" } as const;
export const ERROR = { status: "error" } as const;

/** An API key from the environment; empty or whitespace-only means unset. */
export function envKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Releases an unread body without waiting (a cancel can stay pending, e.g. on a tee'd stream). */
function discard(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

/** Reads at most `limit + 1` bytes of a body; `null` when it is larger than `limit`. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    discard(response);
    return null;
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * GETs an image: 404, 401, 403 → not-found; other non-2xx, network failure or timeout → error; a body larger
 * than 256 KB or not PNG/JPEG/WebP by magic bytes → not-found.
 */
export async function fetchImage(
  fetch: FetchLike,
  url: string,
  provider: string,
  headers: Record<string, string> = {},
): Promise<LogoLookup> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "image/png,image/jpeg,image/webp", ...headers },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (response.status === 404) {
      discard(response);
      return NOT_FOUND;
    }
    if (!response.ok) {
      discard(response);
      console.warn(`Logos: ${provider} HTTP ${response.status}`);
      // A rejected key (401/403) will not fix itself on retry: count it as a miss so the marker is written.
      return response.status === 401 || response.status === 403 ? NOT_FOUND : ERROR;
    }
    const bytes = await readLimited(response, FETCH_MAX_BYTES);
    if (!bytes) return NOT_FOUND;
    const format = sniffImage(bytes);
    return format ? { status: "found", image: { ...format, bytes } } : NOT_FOUND;
  } catch (error) {
    console.warn(`Logos: ${provider} network (${error instanceof Error ? error.name : "unknown"})`);
    return ERROR;
  }
}
