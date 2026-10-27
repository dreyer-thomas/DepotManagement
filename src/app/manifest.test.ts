import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
import { config } from "@/proxy";
import { colors } from "@/theme/tokens";
import { APP_ICONS, APPLE_TOUCH_ICON, PUBLIC_ICON_PATHS } from "./app-icons";
import { metadata, viewport } from "./layout";
import manifest from "./manifest";

// next/font only works inside the Next compiler; the layout's metadata does not depend on it.
vi.mock("next/font/google", () => ({ Roboto: () => ({ variable: "font-roboto" }) }));

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

function readPng(path: string): Buffer {
  const bytes = readFileSync(`${publicDir}${path}`);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return bytes;
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readPng(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** IHDR colour type: 2 = RGB without alpha, 6 = RGBA. */
function pngColorType(path: string): number {
  return readPng(path)[25];
}

/** RGB of pixel 0 in row 0 as `#RRGGBB`; stored raw under every filter type, so no unfiltering is needed. */
function firstPixel(path: string): string {
  const bytes = readPng(path);
  expect(bytes[24]).toBe(8); // bit depth
  const idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString("ascii") === "IDAT") {
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  // raw[0] is the first scanline's filter byte.
  return `#${raw.subarray(1, 4).toString("hex").toUpperCase()}`;
}

describe("web app manifest", () => {
  const result = manifest();

  it("describes the standalone home-screen app", () => {
    expect(result).toMatchObject({
      name: "DepotManagement",
      short_name: "Depot",
      display: "standalone",
      start_url: "/",
      lang: "de",
    });
  });

  it("takes its colours from the theme tokens", () => {
    expect(result.background_color).toBe(colors.background);
    expect(result.theme_color).toBe(colors.surface);
  });

  it("lists 192 and 512 any icons and a 512 maskable icon", () => {
    expect(result.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it.each(APP_ICONS.map((icon) => [icon.src, icon.size] as const))("%s exists with its declared size", (src, size) => {
    expect(existsSync(`${publicDir}${src}`)).toBe(true);
    expect(pngSize(src)).toEqual({ width: size, height: size });
  });

  it.each(["/icons/icon-maskable-512.png", APPLE_TOUCH_ICON.src])("%s is opaque (RGB, no alpha)", (src) => {
    expect(pngColorType(src)).toBe(2);
  });

  it("paints the maskable icon background in the primary token colour", () => {
    expect(firstPixel("/icons/icon-maskable-512.png")).toBe(colors.primary.toUpperCase());
  });

  it("ships a 180x180 apple-touch-icon", () => {
    expect(APPLE_TOUCH_ICON.size).toBe(180);
    expect(pngSize(APPLE_TOUCH_ICON.src)).toEqual({ width: 180, height: 180 });
  });
});

describe("root layout head", () => {
  it("links the icons and enables the iOS web app", () => {
    expect(metadata.icons).toMatchObject({
      icon: { url: "/icons/icon-192.png" },
      apple: { url: "/icons/apple-touch-icon.png" },
    });
    expect(metadata.appleWebApp).toEqual({ capable: true, title: "Depot", statusBarStyle: "default" });
    expect(metadata.other).toEqual({ "apple-mobile-web-app-capable": "yes" });
  });

  it("colours the status bar with surface in light and dark mode", () => {
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: colors.surface },
      { media: "(prefers-color-scheme: dark)", color: colors["surface-dark"] },
    ]);
  });
});

describe("proxy public paths", () => {
  it("lets exactly the manifest and the app icons through without a session", () => {
    expect(PUBLIC_ICON_PATHS).toHaveLength(4);
    for (const url of ["/manifest.webmanifest", ...PUBLIC_ICON_PATHS]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false);
    }
    // The matcher literal names exactly these icon files and no others.
    const iconNames = /icons\/\(\?:([^)]*)\)\\\\?\.png/.exec(config.matcher[0])?.[1]?.split("|");
    expect(iconNames?.map((name) => `/icons/${name}.png`).sort()).toEqual([...PUBLIC_ICON_PATHS].sort());
  });
});

describe("no service worker", () => {
  it("is never registered", () => {
    const src = fileURLToPath(new URL("..", import.meta.url));
    const files = readdirRecursive(src).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file) && !file.endsWith("manifest.test.ts"));
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/serviceWorker/);
    }
  });
});

function readdirRecursive(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}
