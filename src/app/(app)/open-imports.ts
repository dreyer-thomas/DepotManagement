import { countOpenBatches } from "@/modules/import";

/** Number of open import batches for the navigation; a read failure only hides the count. */
export async function openImportCount(): Promise<number> {
  try {
    return await countOpenBatches();
  } catch (error) {
    console.error(`Import: counting open batches failed (${error instanceof Error ? error.name : "unknown"})`);
    return 0;
  }
}
