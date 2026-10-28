import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/_components/back-navigation/BackLink";
import { lastReconciledText } from "@/app/_components/reconciliation/labels";
import { ReconciliationRun, ReconciliationStart } from "@/app/_components/reconciliation/ReconciliationView";
import { businessDate } from "@/core/dates";
import { getDepot, getReconciliation } from "@/modules/ledger";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const depot = await getDepot((await params).id);
  return { title: depot ? `${depot.name} abgleichen` : "Depot nicht gefunden" };
}

/**
 * Depot reconciliation (story 2.9): without an open run the Stichtag form, with one the run's rows. An
 * archived Depot's page is read-only.
 */
export default async function ReconcilePage({ params }: Props) {
  const depot = await getDepot((await params).id);
  if (!depot) notFound();
  const today = businessDate(new Date());
  const { run, lastReconciled } = await getReconciliation(depot.id);
  const readOnly = depot.archived;
  return (
    <>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <BackLink parent={{ href: `/depots/${encodeURIComponent(depot.id)}`, label: depot.name }} self="Depot abgleichen" />
          <Typography variant="pageTitle" component="h1">
            Depot abgleichen
          </Typography>
        </Stack>
        {lastReconciled ? <Typography color="text.secondary">{lastReconciledText(lastReconciled)}</Typography> : null}
      </Stack>
      {readOnly ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Archiviertes Depot – nur lesbar.
        </Alert>
      ) : null}
      {run ? (
        <ReconciliationRun run={run} readOnly={readOnly} />
      ) : readOnly ? (
        <Typography>Kein offener Abgleich.</Typography>
      ) : (
        <ReconciliationStart depotId={depot.id} today={today} />
      )}
    </>
  );
}
