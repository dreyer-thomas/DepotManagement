import { businessDate } from "@/core/dates";
import { formatDate } from "@/core/format";

export const NEWS_EMPTY_TEXT = "Keine Nachrichten der letzten 14 Tage.";
export const NEWS_REFRESHING_TEXT = "Nachrichten werden aktualisiert …";
export const NEWS_REFRESH_FAILED_TEXT = "Nachrichten konnten nicht aktualisiert werden.";
export const NEWS_SESSION_EXPIRED_TEXT = "Sitzung abgelaufen. Bitte erneut anmelden.";
/** Screen-reader hint inside each article link (it opens in a new tab). */
export const NEW_TAB_HINT = " (öffnet in neuem Tab)";
export const ALL_SECURITIES_LABEL = "Alle Wertpapiere";
/** Marker on a news item that expands to an in-app teaser. */
export const TEASER_MARKER = "Kurztext";
/** Link from an expanded teaser to the original article (new tab). */
export const READ_ARTICLE_LABEL = "Zum Artikel";
/** Chip on a news item whose Security is held in a non-archived Depot. */
export const HELD_IN_DEPOT_LABEL = "im Depot";

/** Hidden visually, read by screen readers (same rules as MUI's `visuallyHidden`). */
export const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

/** Alert text after a refresh in which some Securities' news could not be loaded. */
export function newsPartialFailureMessage(count: number): string {
  return `Nachrichten für ${count} ${count === 1 ? "Wertpapier" : "Wertpapiere"} konnten nicht geladen werden.`;
}

/** "<source> · dd.mm.yyyy" with the Europe/Berlin date of the publication instant. */
export function articleMeta(source: string, publishedAt: string): string {
  return `${source} · ${formatDate(businessDate(new Date(publishedAt)))}`;
}

/** Labels of the scope toggle (Alle · Depot · Watchlist). */
export const NEWS_SCOPE_LABELS = { all: "Alle", held: "Depot", watched: "Watchlist" } as const;

/** The news page URL: optionally one Security and a scope other than "all". */
export function newsHref(securityId: string | undefined, scope: keyof typeof NEWS_SCOPE_LABELS = "all"): string {
  const params = [
    ...(scope === "all" ? [] : [`scope=${scope}`]),
    ...(securityId ? [`security=${encodeURIComponent(securityId)}`] : []),
  ];
  return params.length > 0 ? `/news?${params.join("&")}` : "/news";
}
