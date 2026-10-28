import type { NextConfig } from "next";

// `next dev` only serves its client bundles to other hosts listed here (e.g. a phone in the LAN):
// comma-separated host names or wildcards from DEV_ALLOWED_ORIGINS, e.g. "192.168.178.*". Unused by `next start`.
const devAllowedOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

const nextConfig: NextConfig = {
  // Keep the curated AGENTS.md free of the block `next dev` would otherwise add.
  agentRules: false,
  ...(devAllowedOrigins.length > 0 ? { allowedDevOrigins: devAllowedOrigins } : {}),
  // Native modules (SQLite driver, bcrypt), Prisma and pdf.js (unpdf) stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "bcrypt", "unpdf"],
  // The OAuth consent page must never be framed (clickjacking of "Erlauben", story 9.4).
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  experimental: {
    // Uploads go through server actions: Parqet CSVs (up to 5 MB), broker PDF batches (up to 20 MB in
    // total) and export files for a restore (up to 50 MB), plus form overhead.
    serverActions: { bodySizeLimit: "60mb" },
    // `src/proxy.ts` matches every route, and Next buffers request bodies for the proxy only up to this
    // size (default 10 MB) and truncates anything larger, so a big restore upload would arrive cut off.
    proxyClientMaxBodySize: "60mb",
  },
};

export default nextConfig;
