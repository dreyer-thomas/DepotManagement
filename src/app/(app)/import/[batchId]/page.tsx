import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImportBatchView } from "@/app/_components/import/ImportBatchView";
import { getImportBatch } from "@/modules/import";

export const metadata: Metadata = { title: "Import prüfen" };

type Props = { params: Promise<{ batchId: string }> };

export default async function ImportBatchPage({ params }: Props) {
  const batch = await getImportBatch((await params).batchId);
  if (!batch) notFound();
  return <ImportBatchView batch={batch} />;
}
