import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { BackLink } from "@/app/_components/back-navigation/BackLink";
import { brokerLabel } from "@/app/_components/depots/labels";
import { formatDateTime } from "@/core/format";
import type { ImportBatchView as Batch } from "@/modules/import";
import type { SecuritySummary } from "@/modules/ledger";
import { ImportReview } from "./ImportReview";

export { ImportStatusChip } from "./ImportReview";

/** Batch page: title, Depot and Broker, then the review (or the read-only BOOKED batch). */
export function ImportBatchView({ batch, securities, today }: { batch: Batch; securities: SecuritySummary[]; today: string }) {
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center", minWidth: 0 }}>
        <BackLink parent={{ href: "/import", label: "Import" }} self="Import prüfen" />
        <Typography variant="pageTitle" component="h1">
          Import prüfen
        </Typography>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {batch.depotName} · {brokerLabel(batch.broker)} · hochgeladen am {formatDateTime(batch.createdAt)}
      </Typography>
      <ImportReview batch={batch} securities={securities} today={today} />
    </>
  );
}
