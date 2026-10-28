/**
 * Architecture guard: the chart library is wrapped in the chart components (story 4.3; story 4.7 adds the
 * price chart, story 7.4 the bar chart, story 7.6 the drawdown chart, story 7.7 the dividend year-lines
 * chart, story 7.8 the performance chart, story 8.2 the comparison chart, the Depots page the sparkline). Only
 * `src/app/_components/charts/ValueChart.tsx`, `PriceChart.tsx`, `BarsChart.tsx`, `DrawdownChart.tsx`,
 * `PerformanceChart.tsx`, `ComparisonChart.tsx`, `SparklineChart.tsx` and
 * `src/app/_components/analyses/DividendYearLinesChart.tsx` may import
 * `@mui/x-charts` (or any of its subpaths).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_DIR = resolve(__dirname, "../../src");
const WRAPPER = join(SRC_DIR, "app/_components/charts/ValueChart.tsx");
const WRAPPERS = new Set([
  WRAPPER,
  join(SRC_DIR, "app/_components/charts/PriceChart.tsx"),
  join(SRC_DIR, "app/_components/charts/BarsChart.tsx"),
  join(SRC_DIR, "app/_components/charts/DrawdownChart.tsx"),
  join(SRC_DIR, "app/_components/charts/PerformanceChart.tsx"),
  join(SRC_DIR, "app/_components/charts/ComparisonChart.tsx"),
  join(SRC_DIR, "app/_components/charts/SparklineChart.tsx"),
  join(SRC_DIR, "app/_components/analyses/DividendYearLinesChart.tsx"),
]);
const CHART_PACKAGE = /^@mui\/x-charts(\/|$)/;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : listSourceFiles(full);
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

/** All module specifiers: static import/export-from, `import()`, `require()`, import-equals. */
function specifiersOf(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((ref) => ref.fileName);
}

function findViolations(files: { path: string; source: string }[]): string[] {
  return files.flatMap(({ path, source }) =>
    WRAPPERS.has(path)
      ? []
      : specifiersOf(source)
          .filter((specifier) => CHART_PACKAGE.test(specifier))
          .map((specifier) => `${relative(process.cwd(), path)} imports "${specifier}"`),
  );
}

describe("chart library import guard", () => {
  it("only ValueChart.tsx, PriceChart.tsx, BarsChart.tsx, DrawdownChart.tsx, PerformanceChart.tsx, ComparisonChart.tsx, SparklineChart.tsx and DividendYearLinesChart.tsx import @mui/x-charts", () => {
    const files = listSourceFiles(SRC_DIR).map((path) => ({ path, source: readFileSync(path, "utf8") }));
    expect(files.some((file) => file.path === WRAPPER)).toBe(true);
    const violations = findViolations(files);
    expect(violations, `@mui/x-charts imported outside the chart wrappers:\n${violations.join("\n")}`).toEqual([]);
  });

  it("detects the package and its subpaths in every import form, except in the wrapper", () => {
    const source = [
      'import { LineChart } from "@mui/x-charts/LineChart";',
      'export * from "@mui/x-charts";',
      'const c = require("@mui/x-charts/ChartsTooltip");',
      'const d = await import("@mui/x-charts-pro");',
      'import Box from "@mui/material/Box";',
    ].join("\n");
    expect(findViolations([{ path: join(SRC_DIR, "app/x.tsx"), source }])).toEqual([
      `${relative(process.cwd(), join(SRC_DIR, "app/x.tsx"))} imports "@mui/x-charts/LineChart"`,
      `${relative(process.cwd(), join(SRC_DIR, "app/x.tsx"))} imports "@mui/x-charts"`,
      `${relative(process.cwd(), join(SRC_DIR, "app/x.tsx"))} imports "@mui/x-charts/ChartsTooltip"`,
    ]);
    for (const wrapper of WRAPPERS) expect(findViolations([{ path: wrapper, source }])).toEqual([]);
  });
});
