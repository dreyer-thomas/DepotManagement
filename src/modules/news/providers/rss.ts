// Minimal RSS reader shared by the RSS news providers (no XML dependency), pinned by synthetic fixtures.

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes XML entities: the predefined ones (+ `&nbsp;`), `&#N;` and `&#xH;`; unknown ones stay. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return entity;
      }
    }
    return NAMED_ENTITIES[body] ?? entity;
  });
}

/** Text content of an element body: CDATA sections verbatim, the rest entity-decoded, tags dropped. */
export function textContent(body: string): string {
  let text = "";
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  for (let match = cdata.exec(body); match; match = cdata.exec(body)) {
    text += decodeEntities(body.slice(last, match.index).replace(/<[^>]*>/g, ""));
    text += match[1];
    last = match.index + match[0].length;
  }
  return text + decodeEntities(body.slice(last).replace(/<[^>]*>/g, ""));
}

/** Text content of the first `<name>` element of an item, `undefined` when it has none. */
export function element(item: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(item);
  return match ? textContent(match[1]) : undefined;
}

/** True when the body is an RSS feed (has a `<channel` element). */
export function isFeed(body: string): boolean {
  return /<channel[\s>]/.test(body);
}

/** The raw bodies of the `<item>` elements, in feed order. */
export function items(body: string): string[] {
  return [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(([, item]) => item);
}

/** An RFC 822 `pubDate` text as a Date; `undefined` when missing or blank (an invalid date stays invalid). */
export function pubDate(item: string): Date | undefined {
  const text = element(item, "pubDate")?.trim();
  return text ? new Date(text) : undefined;
}
