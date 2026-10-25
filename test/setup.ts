// Runs before every test file: point the `@/db` singleton away from ~/.depotmanagement.
// Tests pass their own temp-database client; the singleton never connects, so no file is created.
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = `file:${join(tmpdir(), "depotmanagement-test-unused.db")}`;
}
