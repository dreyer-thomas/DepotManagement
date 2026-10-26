"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { bookImportBatchAction, decideProposalAction, updateProposalAction } from "@/app/_actions/import";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { SecurityLogo } from "@/app/_components/securities/SecurityLogo";
import { TransactionDialog } from "@/app/_components/transactions/TransactionDialog";
import { transactionTypeLabel } from "@/app/_components/transactions/labels";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { ImportBatchView, ImportItemView, IsinChangeReviewView, ItemReviewStatus, ProposalReviewView, ReviewDecision } from "@/modules/import";
import { type EditableProposalField, editableFields } from "@/modules/import/edit-fields";
import type { SecuritySummary } from "@/modules/ledger";
import { DiscardBatchButton } from "./DiscardBatchButton";
import {
  ACTION_FAILED_MESSAGE,
  bookButtonLabel,
  bookedMessage,
  EDIT_FIELD_LABELS,
  editErrorMessage,
  ITEM_STATUS_LABELS,
  isinChangeNames,
  isinChangeNote,
  isinChangeText,
  ledgerRejectedMessage,
  openDecisionsLabel,
  proposalNotes,
  REUPLOAD_WARNING,
  reviewErrorMessage,
  reviewSummary,
} from "./labels";

const TOUCH_TARGET = { minHeight: 44 } as const;
const NUMERIC = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

const CHIP_COLORS: Record<ItemReviewStatus, { bgcolor: string; color: string }> = {
  PARSED: { bgcolor: "gain.soft", color: "gain.main" },
  AMBIGUOUS: { bgcolor: "stale.soft", color: "stale.main" },
  // MUI's default (grey) chip.
  DUPLICATE: { bgcolor: "action.selected", color: "text.primary" },
  NO_BOOKING: { bgcolor: "action.selected", color: "text.primary" },
  CORPORATE_ACTION: { bgcolor: "action.selected", color: "text.primary" },
  FAILED: { bgcolor: "loss.soft", color: "loss.main" },
};

/** Status chip (DESIGN.md `status-chip-import`): erkannt, mehrdeutig, Duplikat, keine Buchung, Kapitalmaßnahme, fehlgeschlagen. */
export function ImportStatusChip({ status }: { status: ItemReviewStatus }) {
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
        ...CHIP_COLORS[status],
      }}
    >
      {ITEM_STATUS_LABELS[status]}
    </Box>
  );
}

/** A canonical decimal as German form text without grouping: `1234.56` → `1234,56`. */
function inputText(value: string | undefined): string {
  return value === undefined ? "" : value.replace(".", ",");
}

type Review = {
  /** The batch is OPEN: decisions and edits are allowed (booking an archived Depot is disabled separately). */
  editable: boolean;
  batchId: string;
  /** A decision or the booking is pending: row controls are disabled. */
  busy: boolean;
  /** Stores the decision of proposal `view.index` (index 0 of a corporate-action file is its ISIN change). */
  decide: (item: ImportItemView, view: Pick<ProposalReviewView, "key" | "index">, decision: ReviewDecision) => void;
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
};

function EditRow({ review, item, view, columns }: { review: Review; item: ImportItemView; view: ProposalReviewView; columns: number }) {
  const router = useRouter();
  const { proposal } = view;
  const fields = editableFields(proposal.type);
  const [values, setValues] = useState<Record<EditableProposalField, string>>(() => ({
    date: proposal.date,
    quantity: inputText(proposal.quantity),
    price: inputText(proposal.price),
    amount: inputText(proposal.amount),
    fee: inputText(proposal.fee),
    tax: inputText(proposal.tax),
  }));
  const [fieldError, setFieldError] = useState<{ field: EditableProposalField; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setFieldError(null);
    setError(null);
    try {
      const submitted = Object.fromEntries(fields.map((field) => [field, values[field]]));
      const result = await updateProposalAction(review.batchId, item.id, view.index, submitted);
      if (result.ok) {
        review.setEditingKey(null);
        router.refresh();
      } else if (result.reason === "invalid") {
        setFieldError({ field: result.field, message: editErrorMessage(result.field, proposal.type) });
      } else {
        setError(reviewErrorMessage(result.reason));
        if (result.reason === "not-found") router.refresh();
      }
    } catch {
      setError(ACTION_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableRow data-edit-row={view.key}>
      <TableCell colSpan={columns}>
        <Box
          component="form"
          aria-label={`${transactionTypeLabel(proposal.type)} bearbeiten`}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {error ? (
            <Alert severity="error" role="alert" sx={{ mb: 1 }}>
              {error}
            </Alert>
          ) : null}
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
            {fields.map((field) => (
              <TextField
                key={field}
                label={EDIT_FIELD_LABELS[field]}
                type={field === "date" ? "date" : "text"}
                size="small"
                value={values[field]}
                onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                error={fieldError?.field === field}
                helperText={fieldError?.field === field ? fieldError.message : undefined}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: field === "date" ? {} : { inputMode: "decimal" },
                }}
                sx={{ width: field === "date" ? 170 : 140 }}
              />
            ))}
            <Button type="submit" variant="contained" disabled={saving} sx={TOUCH_TARGET}>
              Speichern
            </Button>
            <Button onClick={() => review.setEditingKey(null)} disabled={saving} sx={TOUCH_TARGET}>
              Abbrechen
            </Button>
          </Stack>
        </Box>
      </TableCell>
    </TableRow>
  );
}

function DecisionCell({ review, item, view }: { review: Review; item: ImportItemView; view: ProposalReviewView }) {
  if (view.status === "duplicate") {
    return (
      <Typography variant="body2" color="text.secondary">
        wird nicht gebucht
      </Typography>
    );
  }
  const selected = view.effective === "open" ? null : view.effective;
  const { busy } = review;
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={selected}
        disabled={busy}
        aria-label="Entscheidung"
        onChange={(_event, value: ReviewDecision | null) => {
          if (value !== null && value !== selected) review.decide(item, view, value);
        }}
      >
        <ToggleButton value="book" sx={TOUCH_TARGET}>
          Buchen
        </ToggleButton>
        <ToggleButton value="discard" sx={TOUCH_TARGET}>
          Verwerfen
        </ToggleButton>
      </ToggleButtonGroup>
      <Button
        size="small"
        onClick={() => review.setEditingKey(review.editingKey === view.key ? null : view.key)}
        aria-expanded={review.editingKey === view.key}
        disabled={busy}
        sx={TOUCH_TARGET}
      >
        Bearbeiten
      </Button>
    </Stack>
  );
}

function ProposalTable({ review, item }: { review: Review; item: ImportItemView }) {
  const columns = review.editable ? 8 : 7;
  return (
    <Box sx={{ overflowX: "auto", mt: 1 }}>
      <Table size="small" aria-label={`Vorschläge aus ${item.fileName}`}>
        <TableHead>
          <TableRow>
            <TableCell>Typ</TableCell>
            <TableCell>Datum</TableCell>
            <TableCell>Wertpapier</TableCell>
            <TableCell align="right">Stück</TableCell>
            <TableCell align="right">Betrag</TableCell>
            <TableCell align="right">Gebühr</TableCell>
            <TableCell align="right">Steuer</TableCell>
            {review.editable ? <TableCell>Entscheidung</TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {item.proposals.map((view) => {
            const { proposal } = view;
            const notes = review.editable ? proposalNotes(view) : [];
            return (
              <Fragment key={view.key}>
                <TableRow data-proposal={view.key} data-review-status={view.status}>
                  <TableCell>{transactionTypeLabel(proposal.type)}</TableCell>
                  <TableCell sx={NUMERIC}>{formatDate(proposal.date)}</TableCell>
                  <TableCell>
                    {proposal.isin ? (
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <SecurityLogo securityId={view.securityId ?? `isin:${proposal.isin}`} name={view.securityName ?? proposal.isin} />
                        <Box>
                          <Typography variant="body2">{view.securityName ?? proposal.isin}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={NUMERIC}>
                            {proposal.isin}
                          </Typography>
                        </Box>
                      </Stack>
                    ) : (
                      "–"
                    )}
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
                  {review.editable ? (
                    <TableCell>
                      <DecisionCell review={review} item={item} view={view} />
                    </TableCell>
                  ) : null}
                </TableRow>
                {notes.length > 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns} sx={{ color: view.status === "ambiguous" ? "stale.main" : "text.secondary" }}>
                      {notes.map((note) => (
                        <Typography key={note} variant="body2" component="span" sx={{ display: "block" }}>
                          {note}
                        </Typography>
                      ))}
                    </TableCell>
                  </TableRow>
                ) : null}
                {review.editable && review.editingKey === view.key ? (
                  <EditRow review={review} item={item} view={view} columns={columns} />
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

/** The ISIN change of a corporate-action file: row text, names, and "Als ISIN-Wechsel buchen"/"Verwerfen" or its note. */
function IsinChangeRow({ review, item, change }: { review: Review; item: ImportItemView; change: IsinChangeReviewView }) {
  const { proposal } = change;
  // Like proposal notes, only while the batch is open (a BOOKED batch's own change would read "Bereits erfasst").
  const note = review.editable ? isinChangeNote(change.status) : null;
  const selected = change.effective === "open" ? null : change.effective;
  return (
    <Stack
      data-isin-change={change.key}
      data-review-status={change.status}
      direction="row"
      useFlexGap
      sx={{ mt: 1, gap: 1.5, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
    >
      <Box>
        <Typography variant="body2" sx={NUMERIC}>
          {isinChangeText(proposal)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {isinChangeNames(proposal)}
        </Typography>
      </Box>
      {note !== null ? (
        <Typography variant="body2" color="text.secondary">
          {note}
        </Typography>
      ) : review.editable ? (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={selected}
          disabled={review.busy}
          aria-label="Entscheidung"
          onChange={(_event, value: ReviewDecision | null) => {
            if (value !== null && value !== selected) review.decide(item, { key: change.key, index: 0 }, value);
          }}
        >
          <ToggleButton value="book" sx={TOUCH_TARGET}>
            Als ISIN-Wechsel buchen
          </ToggleButton>
          <ToggleButton value="discard" sx={TOUCH_TARGET}>
            Verwerfen
          </ToggleButton>
        </ToggleButtonGroup>
      ) : null}
    </Stack>
  );
}

/** "Manuell erfassen": the Transaction dialog for the batch Depot, Datum = the file's readable date or today. */
export function ManualEntryButton({
  depot,
  securities,
  date,
}: {
  depot: { id: string; name: string };
  securities: SecuritySummary[];
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant="outlined"
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
        sx={TOUCH_TARGET}
      >
        Manuell erfassen
      </Button>
      <TransactionDialog
        open={open}
        onClose={() => setOpen(false)}
        formKey={session}
        depot={depot}
        securities={securities}
        today={date}
      />
    </>
  );
}

function ItemCard({
  review,
  item,
  batch,
  securities,
  today,
}: {
  review: Review;
  item: ImportItemView;
  batch: ImportBatchView;
  securities: SecuritySummary[];
  today: string;
}) {
  const titleId = `import-item-${item.id}`;
  return (
    <Card component="section" aria-labelledby={titleId}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography id={titleId} component="h2" variant="subtitle1" sx={{ fontWeight: 600, wordBreak: "break-all" }}>
            {item.fileName}
          </Typography>
          {review.editable ||
          item.reviewStatus === "FAILED" ||
          item.reviewStatus === "NO_BOOKING" ||
          item.reviewStatus === "CORPORATE_ACTION" ? (
            <ImportStatusChip status={item.reviewStatus} />
          ) : null}
        </Stack>
        {item.duplicateUpload && batch.status === "OPEN" ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {REUPLOAD_WARNING}
          </Alert>
        ) : null}
        {item.status === "PARSED" && item.reviewStatus !== "FAILED" && item.reason ? (
          <Typography variant="body2" data-import-note sx={{ mt: 1, color: "stale.main" }}>
            {item.reason}
          </Typography>
        ) : null}
        {item.reviewStatus === "NO_BOOKING" && item.reason ? (
          <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
            {item.reason}
          </Typography>
        ) : null}
        {item.reviewStatus === "FAILED" ? (
          <Stack direction="row" useFlexGap sx={{ mt: 1, gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
            {item.reason ? (
              <Typography variant="body2" sx={{ color: "loss.main" }}>
                {item.reason}
              </Typography>
            ) : null}
            {/* A corporate-action notice is recorded in the Position ("Corporate Action"), never as a Transaction. */}
            {batch.status === "OPEN" && !batch.depotArchived && item.documentType !== "corporate-action" ? (
              <ManualEntryButton
                depot={{ id: batch.depotId, name: batch.depotName }}
                securities={securities}
                date={item.documentDate ?? today}
              />
            ) : null}
          </Stack>
        ) : null}
        {item.proposals.length > 0 ? <ProposalTable review={review} item={item} /> : null}
        {item.isinChange ? <IsinChangeRow review={review} item={item} change={item.isinChange} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * The review of an import batch (`mockups/import-review.html`): summary with "Verwerfen" and
 * "N Buchungen buchen" (disabled while a decision is open or nothing is to be booked), one card per file
 * with its chip, proposals with Buchen/Verwerfen and inline "Bearbeiten", notes on duplicates and ambiguous
 * matches, ISIN changes with "Als ISIN-Wechsel buchen"/"Verwerfen" (or "Bereits erfasst"), and "Manuell
 * erfassen" on failed files other than corporate-action notices. Every change goes through a server action and the page
 * refreshes from the server (no optimistic UI). A BOOKED batch is read-only with a link to its Depot.
 */
export function ImportReview({
  batch,
  securities,
  today,
}: {
  batch: ImportBatchView;
  securities: SecuritySummary[];
  /** Today's business date (Europe/Berlin): default Datum of "Manuell erfassen". */
  today: string;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const open = batch.status === "OPEN";

  const decide = async (item: ImportItemView, view: Pick<ProposalReviewView, "key" | "index">, decision: ReviewDecision) => {
    setBusyKey(view.key);
    setError(null);
    try {
      const result = await decideProposalAction(batch.id, item.id, view.index, decision);
      if (result.ok) router.refresh();
      else {
        setError(reviewErrorMessage(result.reason));
        if (result.reason === "not-found") router.refresh();
      }
    } catch {
      setError(ACTION_FAILED_MESSAGE);
    } finally {
      setBusyKey(null);
    }
  };

  const book = async () => {
    setBooking(true);
    setError(null);
    try {
      const result = await bookImportBatchAction(batch.id, JSON.stringify(batch.bookKeys));
      if (result.ok) {
        setEditingKey(null);
        setSnackbar(bookedMessage(result.booked));
        router.refresh();
      } else if (result.reason === "ledger-rejected") {
        setError(ledgerRejectedMessage(result));
      } else {
        // Every other reason means the server's review differs from the one shown: reload it.
        setError(reviewErrorMessage(result.reason));
        router.refresh();
      }
    } catch {
      setError(ACTION_FAILED_MESSAGE);
    } finally {
      setBooking(false);
    }
  };

  const review: Review = {
    editable: open,
    batchId: batch.id,
    busy: busyKey !== null || booking,
    decide: (item, view, decision) => void decide(item, view, decision),
    editingKey,
    setEditingKey,
  };
  const count = batch.bookKeys.length;
  // An open edit row would be booked with its old values: save or cancel it first.
  const disabled =
    booking || busyKey !== null || editingKey !== null || batch.openDecisions > 0 || count === 0 || batch.depotArchived;

  return (
    <>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          {open ? (
            <Stack
              direction="row"
              sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 2, rowGap: 1 }}
            >
              <Typography data-review-summary="">
                {reviewSummary(batch.items.length, batch.files, 0)}
                {batch.openDecisions > 0 ? (
                  <>
                    {" · "}
                    <Box component="b" sx={{ color: "stale.main" }}>
                      {openDecisionsLabel(batch.openDecisions)}
                    </Box>
                  </>
                ) : null}
              </Typography>
              <Stack direction="row" spacing={1}>
                <DiscardBatchButton batchId={batch.id} fileCount={batch.items.length} />
                <Button
                  variant="contained"
                  onClick={() => void book()}
                  disabled={disabled}
                  aria-busy={booking}
                  startIcon={booking ? <CircularProgress size={18} color="inherit" aria-hidden /> : undefined}
                  sx={TOUCH_TARGET}
                >
                  {bookButtonLabel(count)}
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Alert severity="success">
              Dieser Import wurde gebucht. <AppLink href={`/depots/${encodeURIComponent(batch.depotId)}`}>Zum Depot</AppLink>
            </Alert>
          )}
          {open && batch.depotArchived ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Depot ist archiviert. Bitte zuerst reaktivieren, um zu buchen.
            </Alert>
          ) : null}
          {error ? (
            <Alert severity="error" role="alert" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <Stack spacing={2}>
        {batch.items.map((item) => (
          <ItemCard key={item.id} review={review} item={item} batch={batch} securities={securities} today={today} />
        ))}
      </Stack>
      <Snackbar
        open={snackbar !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason !== "clickaway") setSnackbar(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snackbar ? (
          <Alert severity="success" variant="filled" role="status" onClose={() => setSnackbar(null)} sx={{ width: "100%" }}>
            {snackbar}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
