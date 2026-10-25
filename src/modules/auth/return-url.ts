const FALLBACK = "/";

/**
 * Sanitizes a post-login return URL. Only a same-origin path is honored: it must start with a
 * single `/` (not `//`, not `/\`) and must not point at `/login`. Anything else becomes `/`.
 */
export function safeReturnUrl(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    return FALLBACK;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return FALLBACK;
  }
  // Control characters (tab, newline) are stripped by URL parsers and could form `//`.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return FALLBACK;
  }
  let pathname: string;
  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return FALLBACK;
    }
    pathname = parsed.pathname;
  } catch {
    return FALLBACK;
  }
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return FALLBACK;
  }
  return value;
}
