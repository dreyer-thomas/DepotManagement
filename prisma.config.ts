import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/db/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: resolveDatabaseUrl(process.env) },
});
