import { describe, expect, it } from "vitest";
import { RESTORE_MAX_FILE_BYTES } from "@/modules/backup/limits";
import { IMPORT_MAX_BATCH_BYTES } from "@/modules/import/limits";
import { PARQET_MAX_FILE_BYTES } from "@/modules/migration/limits";
import nextConfig from "../../next.config";

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** Parses a Next.js size limit such as `"6mb"` or a byte count into bytes. */
function bytes(limit: unknown): number {
  if (typeof limit === "number") return limit;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)\s*$/i.exec(String(limit));
  if (!match) throw new Error(`Unparseable size limit: ${String(limit)}`);
  return Number(match[1]) * UNITS[match[2].toLowerCase()];
}

describe("next.config.ts", () => {
  it("lets server actions accept a Parqet export of the maximum size (plus form overhead)", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(limit).toBeDefined();
    expect(bytes(limit)).toBeGreaterThan(PARQET_MAX_FILE_BYTES);
  });

  it("lets server actions accept a document upload of the maximum total size (plus form overhead)", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(bytes(limit)).toBeGreaterThan(IMPORT_MAX_BATCH_BYTES);
  });

  it("lets server actions and the proxy accept a restore file of the maximum size (plus form overhead)", () => {
    expect(bytes(nextConfig.experimental?.serverActions?.bodySizeLimit)).toBeGreaterThan(RESTORE_MAX_FILE_BYTES);
    expect(bytes(nextConfig.experimental?.proxyClientMaxBodySize)).toBeGreaterThan(RESTORE_MAX_FILE_BYTES);
  });

  it("forbids framing every /oauth page (consent clickjacking)", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const oauth = rules.find((rule) => rule.source === "/oauth/:path*");
    expect(oauth?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ]),
    );
  });
});
