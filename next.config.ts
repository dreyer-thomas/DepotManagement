import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the curated AGENTS.md free of the block `next dev` would otherwise add.
  agentRules: false,
  // Native SQLite driver and Prisma stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
};

export default nextConfig;
