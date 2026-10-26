import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { type FetchCall, fakeFetch, json } from "../../../test/helpers/providers";
import { ensureSecurity } from "@/modules/ledger";
import { setMapping } from "@/modules/prices";
import {
  fetchMissingLogos,
  type LogoDeps,
  listLogoVersions,
  MARKER_RETRY_DAYS,
  readLogo,
  saveManualLogo,
} from "./index";
import type { FetchLike } from "./providers/shared";

let testDb: TestDatabase;
let dataDir: string;

beforeEach(() => {
  testDb = createTestDatabase();
  dataDir = mkdtempSync(join(tmpdir(), "depot-logos-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

const db = () => testDb.client;
const NOW = new Date("2026-10-26T10:00:00.000Z");
const KEY = "pk_test_key";
const SAP = "DE0007164600";

/** Synthetic image bytes: a format signature followed by filler. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0]);

const image = (bytes: Uint8Array<ArrayBuffer> = PNG, status = 200) =>
  new Response(bytes, { status, headers: { "Content-Type": "image/png" } });
const notFound = () => new Response("not found", { status: 404 });

function deps(fetch: FetchLike, overrides: Partial<LogoDeps> = {}): LogoDeps {
  return { fetch, env: { LOGO_DEV_API_KEY: KEY, DATA_DIR: dataDir }, now: () => NOW, ...overrides };
}

const logosDir = () => join(dataDir, "logos");
const files = () => {
  try {
    return readdirSync(logosDir()).sort();
  } catch {
    return [];
  }
};
const urls = (calls: FetchCall[]) => calls.map((call) => call.url);
const row = (securityId: string) => db().securityLogo.findUnique({ where: { securityId } });

async function stock(isin = SAP, name = "SAP SE", assetType = "STOCK") {
  const result = await ensureSecurity({ isin }, { name, assetType }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function crypto(symbol = "BTC", name = "Bitcoin") {
  const result = await ensureSecurity({ cryptoSymbol: symbol }, { name, assetType: "CRYPTO" }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function mapTo(securityId: string, provider: "YAHOO" | "COINGECKO", symbol: string) {
  const result = await setMapping(securityId, { provider, symbol }, db());
  if (!result.ok) throw new Error("setup failed");
}

const logoDevIsin = (isin: string) => `https://img.logo.dev/isin/${isin}?token=${KEY}&format=png&size=128&fallback=404`;
const elbstreamIsin = (isin: string) => `https://api.elbstream.com/logos/isin/${isin}?format=png`;

describe("fetchMissingLogos", () => {
  it("stores the logo.dev image of a stock without asking Elbstream", async () => {
    const id = await stock();
    const { fetch, calls } = fakeFetch(image());
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 1, notFound: 0, failed: 0 });
    expect(urls(calls)).toEqual([logoDevIsin(SAP)]);
    const stored = await row(id);
    expect(stored).toMatchObject({
      source: "FETCHED",
      provider: "LOGO_DEV",
      fileName: `${id}-${NOW.getTime()}.png`,
      contentType: "image/png",
      fetchedAt: NOW.toISOString(),
    });
    expect(files()).toEqual([`${id}-${NOW.getTime()}.png`]);
    expect(new Uint8Array(readFileSync(join(logosDir(), stored!.fileName!)))).toEqual(PNG);

    // A Security with a stored file is never fetched again.
    const again = fakeFetch(image());
    expect(await fetchMissingLogos(deps(again.fetch), db())).toEqual({ stored: 0, notFound: 0, failed: 0 });
    expect(again.calls).toEqual([]);
  });

  it("falls back to the logo.dev ticker of a Yahoo mapping, then to Elbstream", async () => {
    const id = await stock();
    await mapTo(id, "YAHOO", "SAP.DE");
    const { fetch, calls } = fakeFetch(notFound(), notFound(), image(JPEG));
    await fetchMissingLogos(deps(fetch), db());
    expect(urls(calls)).toEqual([
      logoDevIsin(SAP),
      `https://img.logo.dev/ticker/SAP.DE?token=${KEY}&format=png&size=128&fallback=404`,
      elbstreamIsin(SAP),
    ]);
    expect(await row(id)).toMatchObject({ source: "FETCHED", provider: "ELBSTREAM", contentType: "image/jpeg" });
    expect(files()).toEqual([`${id}-${NOW.getTime()}.jpg`]);
  });

  it("never calls logo.dev without a key", async () => {
    const id = await stock();
    const { fetch, calls } = fakeFetch(image(WEBP));
    await fetchMissingLogos(deps(fetch, { env: { LOGO_DEV_API_KEY: "  ", DATA_DIR: dataDir } }), db());
    expect(urls(calls)).toEqual([elbstreamIsin(SAP)]);
    expect(await row(id)).toMatchObject({ provider: "ELBSTREAM", contentType: "image/webp" });
  });

  it("stores a marker when nothing is found, skips it, and retries once it is older than 30 days", async () => {
    const id = await stock();
    const { fetch, calls } = fakeFetch(notFound());
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 1, failed: 0 });
    expect(await row(id)).toMatchObject({ source: "FETCHED", provider: null, fileName: null, contentType: null });
    expect(files()).toEqual([]);
    expect(calls).toHaveLength(2);

    await fetchMissingLogos(deps(fetch, { now: () => new Date(NOW.getTime() + MARKER_RETRY_DAYS * 86_400_000) }), db());
    expect(calls).toHaveLength(2);

    const later = new Date(NOW.getTime() + (MARKER_RETRY_DAYS + 1) * 86_400_000);
    const retry = fakeFetch(image());
    expect(await fetchMissingLogos(deps(retry.fetch, { now: () => later }), db())).toEqual({ stored: 1, notFound: 0, failed: 0 });
    expect(await row(id)).toMatchObject({ provider: "LOGO_DEV", fetchedAt: later.toISOString() });
  });

  it("writes nothing on a transient failure and retries on the next run", async () => {
    const id = await stock();
    const { fetch, calls } = fakeFetch(new Response("busy", { status: 503 }), notFound());
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 0, failed: 1 });
    expect(await row(id)).toBeNull();
    expect(calls).toHaveLength(2);

    const network = fakeFetch(new Error("ECONNRESET"));
    expect(await fetchMissingLogos(deps(network.fetch), db())).toEqual({ stored: 0, notFound: 0, failed: 1 });
    expect(network.calls).toHaveLength(2);
    expect(await row(id)).toBeNull();
  });

  it.each([401, 403])("treats a rejected key (HTTP %i) as not found and stores the marker", async (status) => {
    const id = await stock();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch, calls } = fakeFetch(new Response("denied", { status }), notFound());
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 1, failed: 0 });
    expect(calls).toHaveLength(2);
    expect(await row(id)).toMatchObject({ source: "FETCHED", fileName: null });
    expect(warn).toHaveBeenCalledWith(`Logos: logo.dev HTTP ${status}`);
  });

  it("keeps HTTP 429 a transient failure", async () => {
    const id = await stock();
    const { fetch } = fakeFetch(new Response("slow down", { status: 429 }), notFound());
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 0, failed: 1 });
    expect(await row(id)).toBeNull();
  });

  it("logs failures without URL, key or identifier", async () => {
    await stock();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch } = fakeFetch(new Response("busy", { status: 503 }), new Error("boom"));
    await fetchMissingLogos(deps(fetch), db());
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("Logos: logo.dev HTTP 503");
    expect(logged).not.toMatch(/https?:|pk_test_key|DE0007164600/);
  });

  it.each([
    ["an HTML page", new Response("<html><body>logo</body></html>", { status: 200, headers: { "Content-Type": "image/png" } })],
    ["a body over 256 KB", image(new Uint8Array([...PNG, ...new Uint8Array(300 * 1024)]))],
    ["an SVG", new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { "Content-Type": "image/svg+xml" } })],
    ["a GIF", image(GIF)],
  ])("treats %s as not found", async (_label, reply) => {
    const id = await stock();
    const { fetch } = fakeFetch(reply);
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 1, failed: 0 });
    expect(await row(id)).toMatchObject({ fileName: null });
    expect(files()).toEqual([]);
  });

  it("looks up a certificate by its issuer's ISIN", async () => {
    const id = await stock("DE000VT00011", "Vontobel Turbo Long SAP", "CERTIFICATE");
    const { fetch, calls } = fakeFetch(notFound(), image());
    await fetchMissingLogos(deps(fetch), db());
    expect(urls(calls)).toEqual([logoDevIsin("CH0012335540"), elbstreamIsin("CH0012335540")]);
    expect(await row(id)).toMatchObject({ provider: "ELBSTREAM" });
  });

  it("stores a marker without requests for a certificate of an unknown issuer", async () => {
    const id = await stock("DE000XX00019", "Turbo Long Allianz", "CERTIFICATE");
    const { fetch, calls } = fakeFetch(image());
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 1, failed: 0 });
    expect(calls).toEqual([]);
    expect(await row(id)).toMatchObject({ source: "FETCHED", fileName: null });
  });

  it("falls back to the CoinGecko image of a crypto Security", async () => {
    const id = await crypto();
    await mapTo(id, "COINGECKO", "bitcoin");
    const coin = { id: "bitcoin", image: { large: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png" } };
    const { fetch, calls } = fakeFetch(notFound(), notFound(), json(coin), image());
    await fetchMissingLogos(deps(fetch, { env: { LOGO_DEV_API_KEY: KEY, COINGECKO_API_KEY: "cg-key", DATA_DIR: dataDir } }), db());
    expect(urls(calls)).toEqual([
      `https://img.logo.dev/crypto/BTC?token=${KEY}&format=png&size=128&fallback=404`,
      "https://api.elbstream.com/logos/crypto/BTC?format=png",
      "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false",
      coin.image.large,
    ]);
    expect(calls[2].headers["x-cg-demo-api-key"]).toBe("cg-key");
    expect(calls[3].headers["x-cg-demo-api-key"]).toBeUndefined();
    expect(await row(id)).toMatchObject({ source: "FETCHED", provider: "COINGECKO" });
  });

  it.each(["http://assets.coingecko.com/x.png", "https://evil.example/x.png", "https://coingecko.com.evil.example/x.png"])(
    "never downloads a CoinGecko image from %s",
    async (large) => {
      const id = await crypto();
      await mapTo(id, "COINGECKO", "bitcoin");
      const { fetch, calls } = fakeFetch(notFound(), notFound(), json({ image: { large } }), image());
      await fetchMissingLogos(deps(fetch), db());
      expect(calls).toHaveLength(3);
      expect(await row(id)).toMatchObject({ fileName: null });
    },
  );

  it("skips CoinGecko for a crypto Security without a CoinGecko mapping", async () => {
    const id = await crypto();
    const { fetch, calls } = fakeFetch(notFound());
    await fetchMissingLogos(deps(fetch), db());
    expect(calls).toHaveLength(2);
    expect(await row(id)).toMatchObject({ fileName: null });
  });

  it("never fetches for a Security with a manual logo", async () => {
    const id = await stock();
    expect(await saveManualLogo(id, PNG, deps(fakeFetch().fetch), db())).toEqual({ ok: true });
    const { fetch, calls } = fakeFetch(image(JPEG));
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 0, notFound: 0, failed: 0 });
    expect(calls).toEqual([]);
    expect(await row(id)).toMatchObject({ source: "MANUAL", provider: null, contentType: "image/png" });
  });

  it("discards its file when an upload wins the race", async () => {
    const id = await stock();
    const uploadAt = new Date(NOW.getTime() - 1000);
    const racing: FetchLike = async () => {
      expect(await saveManualLogo(id, WEBP, { env: { DATA_DIR: dataDir }, now: () => uploadAt }, db())).toEqual({ ok: true });
      return image();
    };
    expect(await fetchMissingLogos(deps(racing), db())).toEqual({ stored: 0, notFound: 0, failed: 0 });
    expect(await row(id)).toMatchObject({ source: "MANUAL", fileName: `${id}-${uploadAt.getTime()}.webp` });
    expect(files()).toEqual([`${id}-${uploadAt.getTime()}.webp`]);
  });

  it("keeps going after a Security fails", async () => {
    const first = await stock();
    const second = await stock("US0378331005", "Apple Inc.");
    const { fetch } = fakeFetch((call) => (call.url.includes(SAP) ? new Response("x", { status: 500 }) : image()));
    expect(await fetchMissingLogos(deps(fetch), db())).toEqual({ stored: 1, notFound: 0, failed: 1 });
    expect(await row(first)).toBeNull();
    expect(await row(second)).toMatchObject({ provider: "LOGO_DEV" });
  });
});

describe("saveManualLogo", () => {
  it("replaces a fetched logo and deletes its file", async () => {
    const id = await stock();
    await fetchMissingLogos(deps(fakeFetch(image()).fetch), db());
    const uploadAt = new Date(NOW.getTime() + 5000);
    expect(await saveManualLogo(id, JPEG, { env: { DATA_DIR: dataDir }, now: () => uploadAt }, db())).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({
      source: "MANUAL",
      provider: null,
      fileName: `${id}-${uploadAt.getTime()}.jpg`,
      contentType: "image/jpeg",
      fetchedAt: uploadAt.toISOString(),
    });
    expect(files()).toEqual([`${id}-${uploadAt.getTime()}.jpg`]);
  });

  it("replaces a marker", async () => {
    const id = await stock();
    await fetchMissingLogos(deps(fakeFetch(notFound()).fetch), db());
    expect(await saveManualLogo(id, PNG, deps(fakeFetch().fetch), db())).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ source: "MANUAL", contentType: "image/png" });
  });

  it.each([
    ["an empty file", new Uint8Array(0), "file-missing"],
    ["a 2 MiB file", new Uint8Array([...PNG, ...new Uint8Array(2 * 1024 * 1024)]), "file-too-large"],
    ["a GIF", GIF, "file-type"],
    ["an SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), "file-type"],
  ])("rejects %s without writing", async (_label, bytes, reason) => {
    const id = await stock();
    expect(await saveManualLogo(id, bytes, deps(fakeFetch().fetch), db())).toEqual({ ok: false, reason });
    expect(await row(id)).toBeNull();
    expect(files()).toEqual([]);
  });

  it("accepts exactly 1 MiB", async () => {
    const id = await stock();
    const bytes = new Uint8Array(1024 * 1024);
    bytes.set(PNG);
    expect(await saveManualLogo(id, bytes, deps(fakeFetch().fetch), db())).toEqual({ ok: true });
  });

  it("returns not-found for an unknown Security", async () => {
    expect(await saveManualLogo("nope", PNG, deps(fakeFetch().fetch), db())).toEqual({ ok: false, reason: "not-found" });
    expect(await saveManualLogo("", PNG, deps(fakeFetch().fetch), db())).toEqual({ ok: false, reason: "not-found" });
    expect(files()).toEqual([]);
  });
});

describe("listLogoVersions and readLogo", () => {
  it("lists versions of stored files only and reads the stored bytes", async () => {
    const withFile = await stock();
    const marker = await stock("US0378331005", "Apple Inc.");
    await saveManualLogo(withFile, PNG, deps(fakeFetch().fetch), db());
    await fetchMissingLogos(deps(fakeFetch(notFound()).fetch), db());
    expect(await listLogoVersions(db())).toEqual({ [withFile]: String(NOW.getTime()) });

    expect(await readLogo(withFile, { env: { DATA_DIR: dataDir } }, db())).toEqual({ bytes: PNG, contentType: "image/png" });
    expect(await readLogo(marker, { env: { DATA_DIR: dataDir } }, db())).toBeNull();
    expect(await readLogo("nope", { env: { DATA_DIR: dataDir } }, db())).toBeNull();
  });

  it("never reads a file name that escapes the logo directory", async () => {
    const id = await stock();
    await db().securityLogo.create({
      data: { securityId: id, source: "MANUAL", fileName: "../../etc/passwd.png", contentType: "image/png", fetchedAt: NOW.toISOString() },
    });
    expect(await readLogo(id, { env: { DATA_DIR: dataDir } }, db())).toBeNull();
  });

  it("never serves a valid file name with a disallowed content type", async () => {
    const id = await stock();
    await saveManualLogo(id, PNG, deps(fakeFetch().fetch), db());
    await db().securityLogo.update({ where: { securityId: id }, data: { contentType: "image/svg+xml" } });
    expect(await readLogo(id, { env: { DATA_DIR: dataDir } }, db())).toBeNull();
  });

  it("returns null when the stored file is missing", async () => {
    const id = await stock();
    await saveManualLogo(id, PNG, deps(fakeFetch().fetch), db());
    rmSync(logosDir(), { recursive: true });
    expect(await readLogo(id, { env: { DATA_DIR: dataDir } }, db())).toBeNull();
  });
});
