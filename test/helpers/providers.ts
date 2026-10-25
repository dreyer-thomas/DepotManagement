// Recorded provider responses and a fake `fetch` for provider tests (tests never touch the network).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES = resolve(__dirname, "../fixtures/providers");

/** A recorded response body from `test/fixtures/providers/<name>.json`. */
export function recorded(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), "utf8"));
}

export type FetchCall = { url: string; method: string; headers: Record<string, string>; body: string | undefined };

type Reply = Response | Error | ((call: FetchCall) => Response | Error);

/** JSON response with the given status. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A fake `fetch` answering with `replies` in order (the last one repeats); an Error reply rejects.
 * `calls` records every request; each request must carry an AbortSignal (timeout).
 */
export function fakeFetch(...replies: Reply[]) {
  const calls: FetchCall[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (!(init?.signal instanceof AbortSignal)) throw new Error("request without timeout signal");
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const call = { url: input, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : undefined };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const value = typeof reply === "function" ? reply(call) : reply;
    if (value instanceof Error) throw value;
    return value.clone();
  };
  return { fetch, calls };
}
