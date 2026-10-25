import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the curated AGENTS.md free of the block `next dev` would otherwise add.
  agentRules: false,
  // Native modules (SQLite driver, bcrypt) and Prisma stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "bcrypt"],
  experimental: {
    // Parqet CSV uploads go through a server action (the preview accepts files up to 5 MB).
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
