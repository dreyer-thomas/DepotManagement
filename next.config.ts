import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the curated AGENTS.md free of the block `next dev` would otherwise add.
  agentRules: false,
  // Native modules (SQLite driver, bcrypt), Prisma and pdf.js (unpdf) stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "bcrypt", "unpdf"],
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
