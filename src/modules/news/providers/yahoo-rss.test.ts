import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { fakeFetch, recordedText } from "../../../../test/helpers/providers";
import { parseYahooRss, searchYahooRss, TEASER_MAX_LENGTH, teaserText, yahooRssUrl } from "./yahoo-rss";

const rss = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/xml" } });
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("yahooRssUrl", () => {
  it("builds the German headline feed URL of the symbol", () => {
    expect(yahooRssUrl("SAP.DE")).toBe("https://feeds.finance.yahoo.com/rss/2.0/headline?s=SAP.DE&region=DE&lang=de-DE");
    expect(new URL(yahooRssUrl("A&B=C")).searchParams.get("s")).toBe("A&B=C");
  });
});

describe("teaserText", () => {
  it("strips entity-encoded HTML, decodes twice and collapses whitespace", () => {
    expect(teaserText("&lt;p&gt;SAP &amp;amp; Co&lt;/p&gt;")).toBe("SAP & Co");
    expect(teaserText("<![CDATA[<p>Eins</p>\n  <p>zwei &amp; drei</p>]]>")).toBe("Eins zwei & drei");
    expect(teaserText("  Kurz  und\tgut ")).toBe("Kurz und gut");
    // Literal comparison signs in prose stay; double-encoded tags are removed.
    expect(teaserText("Umsatz &lt; Prognose, Marge &gt; 20 %")).toBe("Umsatz < Prognose, Marge > 20 %");
    expect(teaserText("&amp;lt;b&amp;gt;Fett&amp;lt;/b&amp;gt; gedruckt")).toBe("Fett gedruckt");
  });

  it("returns null for an empty description", () => {
    expect(teaserText("")).toBeNull();
    expect(teaserText("   ")).toBeNull();
    expect(teaserText("&lt;br/&gt;")).toBeNull();
  });

  it("keeps a teaser of exactly the maximum length", () => {
    const text = "a".repeat(TEASER_MAX_LENGTH);
    expect(teaserText(text)).toBe(text);
  });

  it("cuts a long teaser after the last sentence end within the limit", () => {
    const sentence = `${"Wort ".repeat(95)}Ende.`; // 480 characters
    expect(sentence).toHaveLength(480);
    const text = `${sentence} ${"weiter ".repeat(60)}`;
    expect(teaserText(text)).toBe(sentence);
    // A sentence end right at the limit is kept whole.
    const exact = `${"x".repeat(599)}!`;
    expect(teaserText(`${exact} danach mehr Text`)).toBe(exact);
  });

  it("cuts at a word with an ellipsis when no sentence end keeps 200 characters", () => {
    const text = "wort ".repeat(180); // 900 characters, no sentence end
    const teaser = teaserText(text) ?? "";
    expect(teaser.length).toBeLessThanOrEqual(TEASER_MAX_LENGTH);
    expect(teaser.endsWith("wort…")).toBe(true);
    expect(teaser.length).toBeGreaterThan(590);
    // An early sentence end (below 200 characters) does not count.
    const early = teaserText(`Kurz. ${"wort ".repeat(180)}`) ?? "";
    expect(early.endsWith("…")).toBe(true);
    expect(early.length).toBeLessThanOrEqual(TEASER_MAX_LENGTH);
    // Without any whitespace the text is cut hard.
    expect(teaserText("y".repeat(900))).toBe(`${"y".repeat(TEASER_MAX_LENGTH - 1)}…`);
  });
});

describe("parseYahooRss", () => {
  it("parses items with teasers, a default source, and drops invalid items", () => {
    const articles = parseYahooRss(recordedText("yahoo-rss-sap.xml")) ?? [];
    expect(articles.map((article) => [article.title, article.source, article.publishedAt])).toEqual([
      ["SAP-Aktie legt nach Zahlen zu", "Muster Finanz", "2026-10-26T08:00:00.000Z"],
      ["SAP hebt Prognose an", "Yahoo Finance", "2026-10-26T07:45:00.000Z"],
      ["Walldorfer Konzern im Fokus", "Beispiel Börse", "2026-10-25T12:00:00.000Z"],
      ["Märkte schließen uneinheitlich", "Yahoo Finance", "2026-10-25T16:00:00.000Z"],
      ["SAP vor drei Wochen im Feed", "Yahoo Finance", "2026-10-06T09:00:00.000Z"],
      ["SAP ohne Kurztext", "Yahoo Finance", "2026-10-24T09:00:00.000Z"],
    ]);
    expect(articles[0]).toEqual({
      url: "https://finance.example.com/sap-zahlen",
      title: "SAP-Aktie legt nach Zahlen zu",
      source: "Muster Finanz",
      publishedAt: "2026-10-26T08:00:00.000Z",
      teaser: "SAP & Co",
    });
    expect(articles[1].teaser).toBe("Der Softwarekonzern hebt die Jahresprognose an. Analysten zeigen sich überrascht.");
    const long = articles[2].teaser ?? "";
    expect(long).toHaveLength(480);
    expect(long.startsWith("SAP stellt")).toBe(true);
    expect(long.endsWith(".")).toBe(true);
    expect(articles[5].teaser).toBeNull();
  });

  it("returns undefined for a body without a channel", () => {
    expect(parseYahooRss("<!doctype html><html><body>Consent</body></html>")).toBeUndefined();
    expect(parseYahooRss(recordedText("yahoo-rss-empty.xml"))).toEqual([]);
  });
});

describe("searchYahooRss", () => {
  it("requests the symbol feed with a timeout signal and returns the articles", async () => {
    const { fetch, calls } = fakeFetch(rss(recordedText("yahoo-rss-sap.xml")));
    const result = await searchYahooRss("SAP.DE", fetch);
    expect(calls.map((call) => call.url)).toEqual([yahooRssUrl("SAP.DE")]);
    expect(result.ok && result.articles).toHaveLength(6);
  });

  it("maps HTTP errors, network failures, non-feed bodies and empty channels to a provider error without logging the URL", async () => {
    expect(await searchYahooRss("SAP.DE", fakeFetch(rss("unavailable", 503)).fetch)).toEqual({ ok: false });
    expect(await searchYahooRss("SAP.DE", fakeFetch(new TypeError("fetch failed")).fetch)).toEqual({ ok: false });
    expect(await searchYahooRss("SAP.DE", fakeFetch(rss("<html><body>Consent</body></html>")).fetch)).toEqual({ ok: false });
    expect(await searchYahooRss("SAP.DE", fakeFetch(rss(recordedText("yahoo-rss-empty.xml"))).fetch)).toEqual({ ok: false });
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("HTTP 503");
    expect(logged).toContain("empty feed");
    expect(logged).not.toMatch(/yahoo\.com|SAP/);
  });
});
