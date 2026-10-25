import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders an already-awaited server component tree (sync children only) to static HTML and
 * returns its visible text, with tags dropped, entities decoded and whitespace collapsed.
 */
export function renderText(node: ReactNode): string {
  return renderToStaticMarkup(node)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\n]+/g, " ")
    .trim();
}

/** Static HTML of an already-awaited server component tree. */
export function renderHtml(node: ReactNode): string {
  return renderToStaticMarkup(node);
}
