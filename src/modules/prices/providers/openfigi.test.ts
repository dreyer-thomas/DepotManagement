import { describe, expect, it } from "vitest";
import { fakeFetch, json, recorded } from "../../../../test/helpers/providers";
import { lookupIsinDetails, lookupXetraTickers, OPENFIGI_MAPPING_URL } from "./openfigi";

const SAP = "DE0007164600";
const MSCI_WORLD = "IE00B4L5Y983";
const APPLE = "US0378331005";

describe("lookupXetraTickers", () => {
  it("maps each ISIN to its GY ticker or not-found (recorded response)", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("openfigi-mapping-sap-msci-world-apple")));
    const result = await lookupXetraTickers([SAP, MSCI_WORLD, APPLE], { fetch });
    expect(Object.fromEntries(result)).toEqual({
      [SAP]: { status: "found", value: "SAP" },
      [MSCI_WORLD]: { status: "not-found" },
      [APPLE]: { status: "found", value: "APC" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENFIGI_MAPPING_URL);
    expect(calls[0].method).toBe("POST");
    // Privacy (AD-13): only ISINs and the exchange code leave the server.
    expect(JSON.parse(calls[0].body!)).toEqual([SAP, MSCI_WORLD, APPLE].map((idValue) => ({ idType: "ID_ISIN", idValue, exchCode: "GY" })));
    expect(calls[0].headers).not.toHaveProperty("x-openfigi-apikey");
  });

  it("sends the API key header only when set and then uses chunks of 100", async () => {
    const isins = Array.from({ length: 101 }, (_, i) => `XX${String(i).padStart(10, "0")}`);
    const { fetch, calls } = fakeFetch((call) => json(JSON.parse(call.body!).map(() => ({ warning: "No identifier found." }))));
    await lookupXetraTickers(isins, { fetch, apiKey: "secret-key" });
    expect(calls.map((call) => JSON.parse(call.body!).length)).toEqual([100, 1]);
    expect(calls[0].headers["x-openfigi-apikey"]).toBe("secret-key");
  });

  it("uses chunks of 10 without a key", async () => {
    const isins = Array.from({ length: 23 }, (_, i) => `XX${String(i).padStart(10, "0")}`);
    const { fetch, calls } = fakeFetch((call) => json(JSON.parse(call.body!).map(() => ({ warning: "No identifier found." }))));
    const result = await lookupXetraTickers(isins, { fetch });
    expect(calls.map((call) => JSON.parse(call.body!).length)).toEqual([10, 10, 3]);
    expect([...result.values()].every((lookup) => lookup.status === "not-found")).toBe(true);
  });

  it.each([
    ["HTTP 500", json({ error: "boom" }, 500)],
    ["a network error", new TypeError("fetch failed")],
    ["a non-JSON body", new Response("<html>", { status: 200 })],
    ["a schema mismatch", json({ unexpected: true })],
    ["a wrong result count", json([])],
  ])("marks the chunk as error on %s", async (_label, reply) => {
    const { fetch } = fakeFetch(reply);
    expect(Object.fromEntries(await lookupXetraTickers([SAP], { fetch }))).toEqual({ [SAP]: { status: "error" } });
  });

  it("stops requesting after HTTP 429 and marks the remaining ISINs as error", async () => {
    const isins = Array.from({ length: 25 }, (_, i) => `XX${String(i).padStart(10, "0")}`);
    const { fetch, calls } = fakeFetch(new Response("Too Many Requests", { status: 429 }));
    const result = await lookupXetraTickers(isins, { fetch });
    expect(calls).toHaveLength(1);
    expect([...result.values()].every((lookup) => lookup.status === "error")).toBe(true);
    expect(result.size).toBe(25);
  });

  it("takes the first GY entry whose ticker is valid, skipping an earlier invalid one", async () => {
    const { fetch } = fakeFetch(
      json([
        {
          data: [
            { ticker: "BAD TICKER!", exchCode: "GY" },
            { ticker: "XYZ", exchCode: "GR" },
            { ticker: "sap", exchCode: "GY" },
          ],
        },
      ]),
    );
    expect(Object.fromEntries(await lookupXetraTickers(["A"], { fetch }))).toEqual({ A: { status: "found", value: "SAP" } });
  });

  it("treats a per-job error as error and an invalid ticker as not-found", async () => {
    const { fetch } = fakeFetch(
      json([{ error: "Invalid idValue format." }, { data: [{ ticker: "BAD TICKER!", exchCode: "GY" }] }, { data: [{ ticker: "sap", exchCode: "GY" }] }]),
    );
    const result = await lookupXetraTickers(["A", "B", "C"], { fetch });
    expect(Object.fromEntries(result)).toEqual({
      A: { status: "error" },
      B: { status: "not-found" },
      C: { status: "found", value: "SAP" },
    });
  });
});

// Recorded OpenFIGI answer for an ETF ISIN without exchange filter (trimmed to three listings).
const MSCI_WORLD_ANY_EXCHANGE = [
  {
    data: [
      { figi: "BBG005XXXXX1", name: null, ticker: "EUNL", exchCode: "GR", securityType: "ETP", marketSector: "Equity", securityType2: "Mutual Fund" },
      { figi: "BBG005XXXXX2", name: "ISHARES CORE MSCI WORLD", ticker: "EUNL", exchCode: "GY", securityType: "ETP", marketSector: "Equity", securityType2: "Mutual Fund" },
      { figi: "BBG005XXXXX3", name: "ISHARES CORE MSCI WRLD-ACC", ticker: "SWDA", exchCode: "LN", securityType: "ETP", marketSector: "Equity", securityType2: "Mutual Fund" },
    ],
  },
];

describe("lookupIsinDetails", () => {
  it("returns name and types of the first listing with a name, sending only the ISIN", async () => {
    const { fetch, calls } = fakeFetch(json(MSCI_WORLD_ANY_EXCHANGE));
    expect(await lookupIsinDetails(MSCI_WORLD, { fetch })).toEqual({
      status: "found",
      value: { name: "ISHARES CORE MSCI WORLD", securityType: "ETP", securityType2: "Mutual Fund", marketSector: "Equity" },
    });
    expect(calls[0].url).toBe(OPENFIGI_MAPPING_URL);
    expect(JSON.parse(calls[0].body!)).toEqual([{ idType: "ID_ISIN", idValue: MSCI_WORLD }]);
    expect(calls[0].headers).not.toHaveProperty("x-openfigi-apikey");
  });

  it("sends the API key when set", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("openfigi-mapping-not-found")));
    await lookupIsinDetails(SAP, { fetch, apiKey: "secret-key" });
    expect(calls[0].headers["x-openfigi-apikey"]).toBe("secret-key");
  });

  it("is not-found for a warning or listings without a name", async () => {
    expect(await lookupIsinDetails(SAP, fakeFetch(json(recorded("openfigi-mapping-not-found"))))).toEqual({ status: "not-found" });
    expect(await lookupIsinDetails(SAP, fakeFetch(json([{ data: [{ name: " " }] }])))).toEqual({ status: "not-found" });
  });

  it.each([
    ["HTTP 500", () => json({}, 500)],
    ["HTTP 429", () => json({}, 429)],
    ["a network error", () => new TypeError("fetch failed")],
    ["an unexpected body", () => json({ nope: true })],
    ["a job error", () => json([{ error: "Invalid idType" }])],
    ["a wrong job count", () => json([])],
  ])("is error on %s", async (_label, reply) => {
    expect(await lookupIsinDetails(SAP, fakeFetch(reply()))).toEqual({ status: "error" });
  });
});
