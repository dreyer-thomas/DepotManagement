import { describe, expect, it } from "vitest";
import { fakeFetch, json } from "../../../test/helpers/providers";
import { lookupIsinDetails } from "./index";

describe("lookupIsinDetails (prices entry point)", () => {
  it("passes OPENFIGI_API_KEY from the environment and ignores an empty one", async () => {
    const reply = () => json([{ data: [{ name: "SAP SE", securityType: "Common Stock", securityType2: "Common Stock", marketSector: "Equity" }] }]);
    const withKey = fakeFetch(reply());
    expect(await lookupIsinDetails("DE0007164600", { fetch: withKey.fetch, env: { OPENFIGI_API_KEY: " k " } })).toMatchObject({
      status: "found",
      value: { name: "SAP SE" },
    });
    expect(withKey.calls[0].headers["x-openfigi-apikey"]).toBe("k");
    const blank = fakeFetch(reply());
    await lookupIsinDetails("DE0007164600", { fetch: blank.fetch, env: { OPENFIGI_API_KEY: " " } });
    expect(blank.calls[0].headers).not.toHaveProperty("x-openfigi-apikey");
  });
});
