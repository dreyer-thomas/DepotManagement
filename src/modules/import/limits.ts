// Upload limits of the document import (story 5-1). Safe to import from client components.

/** Most files accepted in one upload. */
export const IMPORT_MAX_FILES = 50;

/** Largest accepted single file in bytes; a larger file becomes a FAILED item. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Largest accepted upload (all files together) in bytes; the server-action body limit must exceed it. */
export const IMPORT_MAX_BATCH_BYTES = 20 * 1024 * 1024;
