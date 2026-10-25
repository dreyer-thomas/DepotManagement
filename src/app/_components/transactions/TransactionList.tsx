"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { useState } from "react";
import { cashEffect } from "@/core/cash";
import { type Split, splitAdjustment } from "@/core/corporate-actions";
import { formatDate, formatMoney, formatMonth, formatQuantity } from "@/core/format";
import type { SecuritySummary, SplitRecord, TransactionRecord } from "@/modules/ledger";
import { SecurityLogo } from "../securities/SecurityLogo";
import { type DialogDepot, TransactionDialog } from "./TransactionDialog";
import { eventValue } from "./transaction-form";
import { CashEffectText, TransactionTypeLabel } from "./TransactionType";

type MonthGroup = { key: string; label: string; transactions: TransactionRecord[] };

/** Groups an already newest-first list by month (`YYYY-MM`), keeping the order. */
function groupByMonth(transactions: TransactionRecord[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const transaction of transactions) {
    const key = transaction.date.slice(0, 7);
    const last = groups.at(-1);
    if (last && last.key === key) last.transactions.push(transaction);
    else groups.push({ key, label: formatMonth(transaction.date), transactions: [transaction] });
  }
  return groups;
}

/** Hidden from sight, still read by screen readers. */
const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
} as const;

/** The edit column stays in view while a narrow table scrolls sideways (phones). */
const actionCell = {
  position: "sticky",
  right: 0,
  bgcolor: "background.paper",
  px: 0.5,
  // Keep the row's hover tint on the opaque sticky cell.
  "tr:hover > &": { backgroundImage: (theme: Theme) => `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})` },
} as const;

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/**
 * The "Stück" cell: a BUY/SELL quantity split-adjusted as of `today`, with the booked quantity as a
 * caption when a split applies. The stored row (and the edit dialog) keep the booked value.
 */
function QuantityText({ transaction, splits, today }: { transaction: TransactionRecord; splits: Split[]; today: string }) {
  if (!transaction.quantity) return null;
  const adjusted =
    transaction.security && (transaction.type === "BUY" || transaction.type === "SELL")
      ? splitAdjustment(transaction.security.id, transaction.date, transaction.quantity, splits, today)
      : null;
  if (adjusted === null) return <>{formatQuantity(transaction.quantity)} Stück</>;
  return (
    <>
      {formatQuantity(adjusted)} Stück
      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
        split-bereinigt (gebucht: {formatQuantity(transaction.quantity)} Stück)
      </Typography>
    </>
  );
}

/**
 * Transactions grouped by month (newest first) as semantic tables. A row click, or its edit button
 * (for keyboard users), opens the Transaction in the edit dialog; `readOnly` (archived Depot) drops
 * both and the dialog. BUY/SELL quantities before a recorded split show split-adjusted as of `today`.
 */
export function TransactionList({
  transactions,
  depot,
  securities,
  today,
  splits = [],
  readOnly = false,
}: {
  transactions: TransactionRecord[];
  depot: DialogDepot;
  securities: SecuritySummary[];
  today: string;
  /** Recorded splits (any Security). */
  splits?: SplitRecord[];
  readOnly?: boolean;
}) {
  const coreSplits: Split[] = splits.map((split) => ({
    securityId: split.security.id,
    date: split.date,
    ratioOld: split.ratioOld,
    ratioNew: split.ratioNew,
  }));
  const [selected, setSelected] = useState<TransactionRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const edit = (transaction: TransactionRecord) => {
    setSelected(transaction);
    setSession((value) => value + 1);
    setOpen(true);
  };
  return (
    <Stack spacing={3}>
      {selected && !readOnly ? (
        <TransactionDialog
          open={open}
          onClose={() => setOpen(false)}
          formKey={session}
          depot={depot}
          securities={securities}
          today={today}
          transaction={selected}
        />
      ) : null}
      {groupByMonth(transactions).map((group) => {
        const headingId = `transactions-month-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId}>
            <Typography id={headingId} component="h2" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {group.label}
            </Typography>
            <Card sx={{ overflowX: "auto" }}>
              <Table size="small" aria-labelledby={headingId}>
                <TableHead>
                  <TableRow>
                    <TableCell>Art</TableCell>
                    <TableCell>Security</TableCell>
                    <TableCell>Datum</TableCell>
                    <TableCell sx={numeric}>Stück</TableCell>
                    <TableCell sx={numeric}>Betrag</TableCell>
                    <TableCell sx={numeric}>Cash-Effekt</TableCell>
                    {readOnly ? null : (
                      <TableCell padding="none" sx={actionCell}>
                        <span style={visuallyHidden}>Aktionen</span>
                      </TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.transactions.map((transaction) => {
                    const name = transaction.security?.name ?? "";
                    return (
                      <TableRow
                        key={transaction.id}
                        hover={!readOnly}
                        onClick={readOnly ? undefined : () => edit(transaction)}
                        sx={{ cursor: readOnly ? undefined : "pointer", "& td": { py: 1 } }}
                      >
                        <TableCell>
                          <TransactionTypeLabel type={transaction.type} />
                        </TableCell>
                        <TableCell>
                          {transaction.security ? (
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 160 }}>
                              <SecurityLogo name={name} />
                              <span>{name}</span>
                            </Stack>
                          ) : null}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(transaction.date)}</TableCell>
                        <TableCell sx={numeric}>
                          <QuantityText transaction={transaction} splits={coreSplits} today={today} />
                        </TableCell>
                        <TableCell sx={numeric}>{formatMoney(eventValue(transaction))}</TableCell>
                        <TableCell sx={numeric}>
                          <CashEffectText value={cashEffect(transaction)} />
                        </TableCell>
                        {readOnly ? null : (
                          <TableCell padding="none" sx={actionCell}>
                            <IconButton
                              aria-label={`Buchung vom ${formatDate(transaction.date)} bearbeiten`}
                              onClick={(event) => {
                                event.stopPropagation();
                                edit(transaction);
                              }}
                              sx={{ minWidth: 44, minHeight: 44 }}
                            >
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </section>
        );
      })}
    </Stack>
  );
}
