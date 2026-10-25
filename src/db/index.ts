import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";
import { resolveDatabaseUrl } from "./database-url";

/** SQLite busy timeout in milliseconds (better-sqlite3 `timeout` option). */
export const BUSY_TIMEOUT_MS = 5000;

/** better-sqlite3 adapter that switches every new connection to WAL mode. */
class WalBetterSqlite3 extends PrismaBetterSqlite3 {
  override async connect() {
    const adapter = await super.connect();
    await adapter.executeScript("PRAGMA journal_mode = WAL;");
    return adapter;
  }
}

export function createPrismaClient(url: string = resolveDatabaseUrl(process.env)): PrismaClient {
  const adapter = new WalBetterSqlite3({ url, timeout: BUSY_TIMEOUT_MS });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Process-wide Prisma client; cached on globalThis in development to survive hot reloads. */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
