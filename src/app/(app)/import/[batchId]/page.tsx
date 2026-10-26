import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImportBatchView } from "@/app/_components/import/ImportBatchView";
import { businessDate } from "@/core/dates";
import { getImportBatch } from "@/modules/import";
import { listSecurities } from "@/modules/ledger";

export const metadata: Metadata = { title: "Import prüfen" };

type Props = { params: Promise<{ batchId: string }> };

export default async function ImportBatchPage({ params }: Props) {
  const batch = await getImportBatch((await params).batchId);
  if (!batch) notFound();
  // Securities and today are for "Manuell erfassen" (the Transaction dialog).
  const securities = await listSecurities();
  return <ImportBatchView batch={batch} securities={securities} today={businessDate(new Date())} />;
}
