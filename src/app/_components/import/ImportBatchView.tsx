import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { brokerLabel } from "@/app/_components/depots/labels";
import { transactionTypeLabel } from "@/app/_components/transactions/labels";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "@/core/format";
import type { ImportBatchView as Batch, ImportItemStatus, ImportItemView, TransactionProposal } from "@/modules/import";
import { DiscardBatchButton } from "./DiscardBatchButton";
import { batchSummary, ITEM_STATUS_LABELS, itemCounts, REUPLOAD_WARNING } from "./labels";

const NUMERIC = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const TONE: Record<ImportItemStatus, "gain" | "loss"> = { PARSED: "gain", FAILED: "loss" };

/** Status chip (DESIGN.md `status-chip-import`): erkannt gain-soft/gain, fehlgeschlagen loss-soft/loss. */
export function ImportStatusChip({ status }: { status: ImportItemStatus }) {
  const tone = TONE[status];
  return (
    <Box
      component="span"
      data-import-status={status}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.25,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        bgcolor: `${tone}.soft`,
        color: `${tone}.main`,
      }}
    >
      {ITEM_STATUS_LABELS[status]}
    </Box>
  );
}

function ProposalTable({ proposals, label }: { proposals: TransactionProposal[]; label: string }) {
  return (
    <Box sx={{ overflowX: "auto", mt: 1 }}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            <TableCell>Typ</TableCell>
            <TableCell>Datum</TableCell>
            <TableCell>Wertpapier</TableCell>
            <TableCell align="right">Stück</TableCell>
            <TableCell align="right">Betrag</TableCell>
            <TableCell align="right">Gebühr</TableCell>
            <TableCell align="right">Steuer</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {proposals.map((proposal, index) => (
            <TableRow key={index}>
              <TableCell>{transactionTypeLabel(proposal.type)}</TableCell>
              <TableCell sx={NUMERIC}>{formatDate(proposal.date)}</TableCell>
              <TableCell>
                {proposal.name ? <Typography variant="body2">{proposal.name}</Typography> : null}
                <Typography variant="body2" color={proposal.name ? "text.secondary" : "text.primary"} sx={NUMERIC}>
                  {proposal.isin ?? "–"}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={NUMERIC}>
                {proposal.quantity === undefined ? "–" : formatQuantity(proposal.quantity)}
              </TableCell>
              <TableCell align="right" sx={NUMERIC}>
                {formatMoney(proposal.amount)}
              </TableCell>
              <TableCell align="right" sx={NUMERIC}>
                {formatMoney(proposal.fee)}
              </TableCell>
              <TableCell align="right" sx={NUMERIC}>
                {formatMoney(proposal.tax)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function ItemCard({ item }: { item: ImportItemView }) {
  const titleId = `import-item-${item.id}`;
  return (
    <Card component="section" aria-labelledby={titleId}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography id={titleId} component="h2" variant="subtitle1" sx={{ fontWeight: 600, wordBreak: "break-all" }}>
            {item.fileName}
          </Typography>
          <ImportStatusChip status={item.status} />
        </Stack>
        {item.duplicateUpload ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {REUPLOAD_WARNING}
          </Alert>
        ) : null}
        {item.status === "FAILED" && item.reason ? (
          <Typography variant="body2" sx={{ mt: 1, color: "loss.main" }}>
            {item.reason}
          </Typography>
        ) : null}
        {item.proposals.length > 0 ? <ProposalTable proposals={item.proposals} label={`Vorschläge aus ${item.fileName}`} /> : null}
      </CardContent>
    </Card>
  );
}

/** Batch view: Depot and Broker, the summary line with "Verwerfen", and one card per file in upload order. */
export function ImportBatchView({ batch }: { batch: Batch }) {
  const counts = itemCounts(batch.items);
  return (
    <>
      <Typography variant="pageTitle" component="h1" sx={{ mb: 0.5 }}>
        Import prüfen
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {batch.depotName} · {brokerLabel(batch.broker)} · hochgeladen am {formatDateTime(batch.createdAt)}
      </Typography>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack
            direction="row"
            sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 2, rowGap: 1 }}
          >
            <Typography>{batchSummary(counts)}</Typography>
            {batch.status === "OPEN" ? <DiscardBatchButton batchId={batch.id} fileCount={counts.fileCount} /> : null}
          </Stack>
        </CardContent>
      </Card>
      <Stack spacing={2}>
        {batch.items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </Stack>
    </>
  );
}
