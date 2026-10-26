import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
/** Lines without comments, trimmed, non-empty. */
const directives = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line !== "");

const UNITS: Record<string, number> = { "": 1, b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 };

/** Parses a Next.js (`"60mb"`) or Nginx (`64m`) size into bytes. */
function bytes(limit: unknown): number {
  if (typeof limit === "number") return limit;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb?|mb?|gb?|)\s*$/i.exec(String(limit));
  if (!match) throw new Error(`Unparseable size limit: ${String(limit)}`);
  return Number(match[1]) * UNITS[match[2].toLowerCase()];
}

describe("deploy/nginx/depotmanagement.conf", () => {
  const nginx = directives(read("deploy/nginx/depotmanagement.conf"));

  it("accepts uploads at least as large as the Next.js limits", () => {
    const line = nginx.find((l) => l.startsWith("client_max_body_size "));
    expect(line).toBeDefined();
    const size = bytes(line!.replace(/^client_max_body_size\s+/, "").replace(/;$/, ""));
    expect(size).toBeGreaterThanOrEqual(bytes(nextConfig.experimental?.serverActions?.bodySizeLimit));
    expect(size).toBeGreaterThanOrEqual(bytes(nextConfig.experimental?.proxyClientMaxBodySize));
  });

  it("proxies to the app on 127.0.0.1:3000 with the forwarding headers", () => {
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000;");
    expect(nginx).toContain("proxy_set_header Host $host;");
    expect(nginx).toContain("proxy_set_header X-Forwarded-Host $host;");
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    expect(nginx).toContain("proxy_set_header X-Forwarded-Proto $scheme;");
  });

  it("terminates TLS on 443 and redirects port 80 to HTTPS", () => {
    expect(nginx).toContain("listen 443 ssl;");
    expect(nginx).toContain("listen 80;");
    expect(nginx).toContain("return 301 https://$host$request_uri;");
    expect(nginx.some((l) => l.startsWith("add_header Strict-Transport-Security "))).toBe(true);
  });

  it("allows long requests for large imports and restores", () => {
    for (const name of ["proxy_read_timeout", "proxy_send_timeout"]) {
      const line = nginx.find((l) => l.startsWith(`${name} `));
      expect(Number(/(\d+)s;$/.exec(line ?? "")?.[1])).toBeGreaterThanOrEqual(300);
    }
  });
});

describe("package.json", () => {
  it("starts the production server through scripts/start.sh", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toBe("sh scripts/start.sh");
  });
});

describe("deploy/systemd/depotmanagement.service", () => {
  const unit = directives(read("deploy/systemd/depotmanagement.service"));
  const value = (key: string) => unit.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

  it("restarts on failure and logs to journald", () => {
    expect(value("Restart")).toBe("on-failure");
    expect(value("StandardOutput")).toBe("journal");
    expect(value("StandardError")).toBe("journal");
  });

  it("reads its environment from a file outside the checkout", () => {
    const workingDirectory = value("WorkingDirectory");
    const environmentFile = value("EnvironmentFile");
    expect(workingDirectory).toMatch(/^\//);
    expect(environmentFile).toMatch(/^\//);
    expect(`${environmentFile}/`.startsWith(`${workingDirectory!.replace(/\/$/, "")}/`)).toBe(false);
  });

  it("runs in production mode with telemetry off, owner-only files and a start limit", () => {
    expect(unit).toContain("Environment=NODE_ENV=production");
    expect(unit).toContain("Environment=NEXT_TELEMETRY_DISABLED=1");
    expect(value("UMask")).toBe("0077");
    expect(Number(value("StartLimitBurst"))).toBeGreaterThan(0);
    expect(Number(value("StartLimitIntervalSec"))).toBeGreaterThan(0);
  });

  it("starts through scripts/start.sh", () => {
    expect(value("ExecStart")).toMatch(/\/scripts\/start\.sh$/);
    expect(value("ExecStart")!.startsWith(value("WorkingDirectory")!)).toBe(true);
  });
});
