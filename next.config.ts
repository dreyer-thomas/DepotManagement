import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the curated AGENTS.md free of the block `next dev` would otherwise add.
  agentRules: false,
  // Native modules (SQLite driver, bcrypt), Prisma and pdf.js (unpdf) stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "bcrypt", "unpdf"],
  experimental: {
    // Uploads go through server actions: Parqet CSVs (up to 5 MB) and broker PDF batches (up to 20 MB in total).
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
