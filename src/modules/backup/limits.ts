// Restore upload limit (story 6.2). Kept in its own file so `next.config.ts` tests and client code can
// import it without the database.

/** Largest export file a restore accepts (50 MB). */
export const RESTORE_MAX_FILE_BYTES = 50 * 1024 * 1024;
