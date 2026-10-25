// Shared fakes for `next/headers` and `next/navigation` in server action / page tests.

export class RedirectError extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

export type CookieSet = { name: string; value: string; options?: Record<string, unknown> };

export function createRequestFakes() {
  const state = {
    incoming: new Map<string, string>(),
    headers: new Headers(),
    set: [] as CookieSet[],
    deleted: [] as string[],
  };
  const cookieStore = {
    get: (name: string) => (state.incoming.has(name) ? { name, value: state.incoming.get(name)! } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      state.set.push({ name, value, options });
    },
    delete: (name: string) => {
      state.deleted.push(name);
    },
  };
  const reset = () => {
    state.incoming.clear();
    state.headers = new Headers();
    state.set = [];
    state.deleted = [];
  };
  return { state, cookieStore, reset };
}

/** Runs fn and returns the redirect URL it threw, failing if it did not redirect. */
export async function expectRedirect(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RedirectError) {
      return error.url;
    }
    throw error;
  }
  throw new Error("expected a redirect");
}

type AnyElement = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** Depth-first search of a React element tree (as returned by a server component) for `type`. */
export function findElement(node: unknown, type: unknown): AnyElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (node && typeof node === "object" && "type" in node && "props" in node) {
    const element = node as AnyElement;
    if (element.type === type) return element;
    return findElement(element.props.children, type);
  }
  return undefined;
}
