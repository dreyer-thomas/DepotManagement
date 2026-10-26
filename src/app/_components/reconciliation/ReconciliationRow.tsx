"use client";

import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import NextLink from "next/link";
import { useState, useTransition } from "react";
import { saveReconciliationRowAction } from "@/app/_actions/reconciliation";
import type { ReconciliationRowRecord } from "@/modules/ledger";
import { securityHref } from "../security-detail/labels";
import { SecurityLogo } from "../securities/SecurityLogo";
import { inputValue, reconciliationErrorMessage, rowName, rowValueText, statusText } from "./labels";

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const TOUCH_TARGET = { minHeight: 44 };
const ACTION_FAILED = "Speichern fehlgeschlagen. Bitte erneut versuchen.";

/** Status with an icon and text (never colour alone). */
function StatusCell({ row }: { row: ReconciliationRowRecord }) {
  const Icon = row.status === "reconciled" ? CheckCircleOutlined : row.status === "difference" ? WarningAmberOutlined : RadioButtonUnchecked;
  const color = row.status === "reconciled" ? "success" : row.status === "difference" ? "warning" : "disabled";
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", whiteSpace: "nowrap" }}>
      <Icon fontSize="small" color={color} aria-hidden />
      <span>{statusText(row)}</span>
    </Stack>
  );
}

/**
 * One row of an open run: name, "Laut App", the statement input (saved on blur or Enter), the "stimmt"
 * check, the status and, on a differing row, "Buchungen ansehen" (Positions) and "Korrektur buchen". The
 * shown values are the server's; nothing is updated optimistically. `readOnly` (archived Depot) disables
 * every write.
 */
export function ReconciliationRow({
  runId,
  depotId,
  row,
  readOnly,
  onCorrect,
}: {
  runId: string;
  depotId: string;
  row: ReconciliationRowRecord;
  readOnly: boolean;
  onCorrect: (row: ReconciliationRowRecord) => void;
}) {
  const isCash = row.securityId === null;
  const name = rowName(row);
  const saved = inputValue(row.statementValue);
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (input: { statementValue?: string; checked?: boolean }) =>
    startTransition(async () => {
      try {
        const result = await saveReconciliationRowAction(runId, row.securityId, input);
        setError(result.ok ? null : reconciliationErrorMessage(result, isCash));
      } catch {
        setError(ACTION_FAILED);
      }
    });

  const commit = () => {
    if (text.trim() === saved) return;
    save({ statementValue: text });
  };

  return (
    <TableRow sx={{ "& td": { py: 1 } }} aria-busy={pending || undefined}>
      <TableCell>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 160 }}>
          {row.security ? <SecurityLogo securityId={row.security.id} name={name} /> : null}
          <span>{name}</span>
        </Stack>
      </TableCell>
      <TableCell sx={numeric}>{rowValueText(isCash, row.appValue)}</TableCell>
      <TableCell sx={{ minWidth: 150 }}>
        <TextField
          size="small"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          disabled={readOnly}
          error={Boolean(error)}
          helperText={error ?? undefined}
          placeholder={isCash ? "€" : "Stück"}
          slotProps={{
            htmlInput: {
              "aria-label": `Laut Auszug: ${name}`,
              inputMode: isCash ? "text" : "decimal",
              autoComplete: "off",
              style: { textAlign: "right" },
            },
          }}
        />
      </TableCell>
      <TableCell padding="checkbox">
        <Checkbox
          checked={row.checked}
          disabled={readOnly}
          onChange={(event) => save({ checked: event.target.checked })}
          slotProps={{ input: { "aria-label": `stimmt: ${name}` } }}
          sx={{ width: 44, height: 44 }}
        />
      </TableCell>
      <TableCell>
        <StatusCell row={row} />
      </TableCell>
      <TableCell>
        {row.status === "difference" ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
            {row.securityId !== null ? (
              <MuiLink
                component={NextLink}
                href={`${securityHref(row.securityId, depotId)}#security-transactions`}
                underline="hover"
                sx={{ whiteSpace: "nowrap" }}
              >
                Buchungen ansehen
              </MuiLink>
            ) : null}
            {readOnly ? null : (
              <Button size="small" variant="outlined" onClick={() => onCorrect(row)} sx={{ ...TOUCH_TARGET, whiteSpace: "nowrap" }}>
                Korrektur buchen
              </Button>
            )}
          </Stack>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
