import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { fakeFetch, recordedText } from "../../../../test/helpers/providers";
import { googleNewsUrl, parseGoogleNewsRss, searchGoogleNews } from "./google-news";
import { decodeEntities, textContent } from "./rss";
import { TITLE_MAX_LENGTH } from "./shared";

const rss = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/xml" } });
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("googleNewsUrl", () => {
  it("builds the de and en search URLs with a quoted 14-day query", () => {
    const de = new URL(googleNewsUrl("SAP", "de"));
    expect(de.origin + de.pathname).toBe("https://news.google.com/rss/search");
    expect(de.searchParams.get("q")).toBe('"SAP" when:14d');
    expect([de.searchParams.get("hl"), de.searchParams.get("gl"), de.searchParams.get("ceid")]).toEqual(["de", "DE", "DE:de"]);
    const en = new URL(googleNewsUrl("Deutsche Telekom", "en"));
    expect(en.searchParams.get("q")).toBe('"Deutsche Telekom" when:14d');
    expect([en.searchParams.get("hl"), en.searchParams.get("gl"), en.searchParams.get("ceid")]).toEqual(["en-US", "US", "US:en"]);
  });

  it("encodes special characters and drops quotes inside the term", () => {
    const url = new URL(googleNewsUrl('Procter & "Gamble"', "de"));
    expect(url.searchParams.get("q")).toBe('"Procter & Gamble" when:14d');
    expect(url.searchParams.get("hl")).toBe("de");
  });
});

describe("decodeEntities / textContent", () => {
  it("decodes named, decimal and hex entities and keeps unknown ones", () => {
    expect(decodeEntities("A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos; w&#228;chst &#x2013; &bogus; &#x110000;")).toBe(
      "A & B <c> \"d\" 'e' wächst – &bogus; &#x110000;",
    );
  });

  it("keeps CDATA verbatim and decodes the rest", () => {
    expect(textContent("<![CDATA[a &amp; <b>]]> &amp; c")).toBe("a &amp; <b> & c");
  });
});

describe("parseGoogleNewsRss", () => {
  it("parses items, decodes entities and CDATA, strips the source suffix and drops bad items", () => {
    const articles = parseGoogleNewsRss(recordedText("google-news-rss-sap-de.xml"));
    expect(articles).toEqual([
      {
        url: "https://news.example.com/sap-prognose",
        title: "SAP hebt Prognose an",
        source: "Beispiel Zeitung",
        publishedAt: "2026-10-26T07:30:00.000Z",
      },
      {
        url: "https://news.example.com/sap-cloud?id=1&ref=rss",
        title: "SAP & Partner: Cloud-Umsatz wächst – Analyse",
        source: "Finanz Blatt",
        publishedAt: "2026-10-24T12:00:00.000Z",
      },
      {
        url: "https://news.example.com/sap-shared",
        title: "SAP startet KI-Offensive",
        source: "Tech Muster",
        publishedAt: "2026-10-23T15:00:00.000Z",
      },
      {
        url: "https://boerse.example.com/sap-anleger",
        title: "SAP-Aktie: Was <Anleger> jetzt wissen müssen",
        source: "Börse Muster",
        publishedAt: "2026-10-13T09:00:00.000Z",
      },
      // The 20-day-old item is still parsed; the window is applied by the refresh.
      {
        url: "https://archiv.example.com/sap-alt",
        title: "SAP vor drei Wochen",
        source: "Archiv Muster",
        publishedAt: "2026-10-06T09:00:00.000Z",
      },
    ]);
  });

  it("returns zero articles for a valid empty channel and undefined for a body without a channel", () => {
    expect(parseGoogleNewsRss(recordedText("google-news-rss-empty.xml"))).toEqual([]);
    expect(parseGoogleNewsRss("<!doctype html><html><body>Consent</body></html>")).toBeUndefined();
  });

  it("keeps a title without the source suffix, caps long titles and drops unparsable dates and a missing source", () => {
    const long = "x".repeat(400);
    const body = `<rss><channel>
      <item><title>Plain headline</title><link>https://a.example.com/1</link><pubDate>Mon, 26 Oct 2026 07:30:00 GMT</pubDate><source url="https://a.example.com">Quelle</source></item>
      <item><title>${long}</title><link>https://a.example.com/2</link><pubDate>Mon, 26 Oct 2026 07:30:00 GMT</pubDate><source>Quelle</source></item>
      <item><title>Bad date</title><link>https://a.example.com/3</link><pubDate>someday</pubDate><source>Quelle</source></item>
      <item><title>No source</title><link>https://a.example.com/4</link><pubDate>Mon, 26 Oct 2026 07:30:00 GMT</pubDate></item>
      <item><title>Relative link</title><link>/relative</link><pubDate>Mon, 26 Oct 2026 07:30:00 GMT</pubDate><source>Quelle</source></item>
    </channel></rss>`;
    const articles = parseGoogleNewsRss(body) ?? [];
    expect(articles.map((article) => article.title)).toEqual(["Plain headline", "x".repeat(TITLE_MAX_LENGTH)]);
  });
});

describe("searchGoogleNews", () => {
  it("requests the edition URL with a timeout signal and returns the articles", async () => {
    const { fetch, calls } = fakeFetch(rss(recordedText("google-news-rss-sap-en.xml")));
    const result = await searchGoogleNews("SAP", "en", fetch);
    expect(calls.map((call) => call.url)).toEqual([googleNewsUrl("SAP", "en")]);
    expect(result).toEqual({
      ok: true,
      articles: [
        expect.objectContaining({ url: "https://news.example.com/sap-shared", title: "SAP launches AI push", source: "Tech Example" }),
        expect.objectContaining({ url: "https://wire.example.org/sap-earnings", title: "SAP shares rise after earnings" }),
      ],
    });
  });

  it("maps HTTP errors, network failures and non-feed bodies to a provider error without logging the URL", async () => {
    expect(await searchGoogleNews("SAP", "de", fakeFetch(rss("unavailable", 503)).fetch)).toEqual({ ok: false });
    expect(await searchGoogleNews("SAP", "de", fakeFetch(new TypeError("fetch failed")).fetch)).toEqual({ ok: false });
    expect(await searchGoogleNews("SAP", "de", fakeFetch(rss("<html><body>Consent</body></html>")).fetch)).toEqual({ ok: false });
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("HTTP 503");
    expect(logged).not.toMatch(/news\.google\.com|SAP/);
  });

  it("returns zero articles for an empty feed", async () => {
    expect(await searchGoogleNews("Muster", "de", fakeFetch(rss(recordedText("google-news-rss-empty.xml"))).fetch)).toEqual({
      ok: true,
      articles: [],
    });
  });
});
