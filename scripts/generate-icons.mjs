#!/usr/bin/env node
// Generates the home-screen app icons (story 8-1) into public/icons/ from an inline SVG.
// Run with `node scripts/generate-icons.mjs`; the PNG output is committed. Uses sharp (installed as
// Next's optional dependency) only here, never at runtime. The colours come from src/theme/tokens.ts.
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const tokens = await readFile(`${root}src/theme/tokens.ts`, "utf8");
function token(name) {
  const hex = new RegExp(`^\\s*${name}:\\s*"(#[0-9A-Fa-f]{6})"`, "m").exec(tokens)?.[1];
  if (!hex) {
    console.error(`generate-icons: colors.${name} not found in src/theme/tokens.ts`);
    process.exit(1);
  }
  return hex;
}
const primary = token("primary");
// The glyph uses the surface token (white), the AppBar colour.
const glyph = token("surface");

/**
 * A rising chart line in the surface colour with an end dot on the primary colour, drawn on a 100×100 grid.
 * `scale` shrinks the glyph around the centre; the maskable icon keeps it inside the 80 % safe zone.
 */
function svg({ size, rounded, scale }) {
  const radius = rounded ? 22 : 0;
  const offset = (100 - 100 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${radius}" ry="${radius}" fill="${primary}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <polyline points="20,70 40,50 55,60 80,30" fill="none" stroke="${glyph}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="80" cy="30" r="7" fill="${glyph}"/>
    <line x1="20" y1="82" x2="80" y2="82" stroke="${glyph}" stroke-width="5" stroke-linecap="round" opacity="0.6"/>
  </g>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, rounded: true, scale: 1 },
  { file: "icon-512.png", size: 512, rounded: true, scale: 1 },
  // Full-bleed; the glyph spans about x 16..87 and y 23..84.5 at scale 1. At scale 0.75 its furthest point
  // is about 35 units from the centre, inside the 40-unit radius of the central 80 % safe zone.
  { file: "icon-maskable-512.png", size: 512, rounded: false, scale: 0.75 },
  // iOS applies its own mask and needs an opaque full-bleed square.
  { file: "apple-touch-icon.png", size: 180, rounded: false, scale: 0.9 },
];

const outDir = `${root}public/icons/`;
await mkdir(outDir, { recursive: true });
for (const icon of ICONS) {
  const image = sharp(Buffer.from(svg(icon)), { density: 72 * (icon.size / 100) }).resize(icon.size, icon.size);
  // Rounded icons keep their transparent corners; full-bleed icons are flattened to opaque RGB.
  const output = icon.rounded ? image.png({ compressionLevel: 9 }) : image.flatten({ background: primary }).png({ compressionLevel: 9 });
  await output.toFile(`${outDir}${icon.file}`);
  console.log(`wrote public/icons/${icon.file} (${icon.size}x${icon.size})`);
}
