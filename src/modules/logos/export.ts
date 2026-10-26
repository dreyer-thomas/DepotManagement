// Export reader of manually uploaded logos (story 6.1). Fetched logos and markers are caches and are
// never exported; a MANUAL row without a usable file (missing, unreadable, empty, invalid name or
// content type) is skipped with one data-free warning.
import { LOGO_CONTENT_TYPES } from "./image";
import type { LogoDeps, LogosDb } from "./logos";
import { logosDir, readLogoFile } from "./storage";

export type ManualLogoExport = { id: string; securityId: string; contentType: string; fetchedAt: string; data: string };

/** MANUAL logos sorted by `securityId`, each with the file bytes as base64 in `data`. */
export async function exportManualLogos(deps: Pick<LogoDeps, "env">, db: LogosDb): Promise<ManualLogoExport[]> {
  const rows = await db.securityLogo.findMany({
    where: { source: "MANUAL" },
    select: { id: true, securityId: true, fileName: true, contentType: true, fetchedAt: true },
    orderBy: { securityId: "asc" },
  });
  const dir = logosDir(deps.env ?? process.env);
  const logos: ManualLogoExport[] = [];
  let skipped = 0;
  for (const row of rows) {
    const bytes = row.fileName && row.contentType && LOGO_CONTENT_TYPES.includes(row.contentType) ? readLogoFile(dir, row.fileName) : null;
    if (!bytes || bytes.length === 0 || !row.contentType) {
      skipped += 1;
      continue;
    }
    logos.push({
      id: row.id,
      securityId: row.securityId,
      contentType: row.contentType,
      fetchedAt: row.fetchedAt,
      data: bytes.toString("base64"),
    });
  }
  if (skipped > 0) console.warn(`Logos: export skipped ${skipped} manual logos with an unusable file`);
  return logos;
}
