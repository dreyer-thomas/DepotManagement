"use client";

import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { formatMoney, formatQuantity } from "@/core/format";
import type { PositionRecord } from "@/modules/ledger";
import { SecurityLogo } from "../securities/SecurityLogo";
import { GainLossPill } from "./GainLossPill";
import {
  DEFAULT_POSITION_SORT,
  initialSortDirection,
  nextSort,
  POSITION_SORT_KEYS,
  POSITION_SORT_LABELS,
  type PositionSort,
  type PositionSortKey,
  selectSortKey,
  sortPositions,
  toggleSortDirection,
} from "./sort-positions";

const MISSING = "–";
const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const money = (value: string | null) => (value === null ? MISSING : formatMoney(value));

function GainLoss({ position }: { position: PositionRecord }) {
  return position.gain === null ? <span>{MISSING}</span> : <GainLossPill gain={position.gain} ratio={position.gainRatio} />;
}

function SecurityName({ name }: { name: string }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
      <SecurityLogo name={name} />
      <Typography component="span" variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
        {name}
      </Typography>
    </Stack>
  );
}

type Sort = PositionSort;

function DesktopTable({ rows, sort, onSort }: { rows: PositionRecord[]; sort: Sort; onSort: (key: PositionSortKey) => void }) {
  return (
    <Card sx={{ overflowX: "auto", display: { xs: "none", md: "block" } }}>
      <Table size="small" aria-label="Positionen">
        <TableHead>
          <TableRow>
            {POSITION_SORT_KEYS.map((key) => {
              const active = sort.key === key;
              return (
                <TableCell
                  key={key}
                  sx={key === "name" ? undefined : numeric}
                  sortDirection={active ? sort.direction : false}
                >
                  <TableSortLabel
                    active={active}
                    direction={active ? sort.direction : initialSortDirection(key)}
                    onClick={() => onSort(key)}
                    sx={{ minHeight: 44 }}
                  >
                    {POSITION_SORT_LABELS[key]}
                  </TableSortLabel>
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((position) => (
            <TableRow key={position.security.id} sx={{ "& td": { py: 1 } }}>
              <TableCell>
                <SecurityName name={position.security.name} />
              </TableCell>
              <TableCell sx={numeric}>{formatQuantity(position.quantity)}</TableCell>
              <TableCell sx={numeric}>{formatMoney(position.costBasis)}</TableCell>
              <TableCell sx={numeric}>{formatMoney(position.averagePrice)}</TableCell>
              <TableCell sx={numeric}>{money(position.price)}</TableCell>
              <TableCell sx={numeric}>{money(position.value)}</TableCell>
              <TableCell sx={numeric}>
                <GainLoss position={position} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function PhoneList({ rows, sort, onChange }: { rows: PositionRecord[]; sort: Sort; onChange: (sort: Sort) => void }) {
  const ascending = sort.direction === "asc";
  return (
    <Box sx={{ display: { xs: "block", md: "none" } }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
        <TextField
          select
          size="small"
          label="Sortieren nach"
          value={sort.key}
          onChange={(event) => onChange(selectSortKey(event.target.value as PositionSortKey))}
          sx={{ minWidth: 180, "& .MuiInputBase-root": { minHeight: 44 } }}
        >
          {POSITION_SORT_KEYS.map((key) => (
            <MenuItem key={key} value={key}>
              {POSITION_SORT_LABELS[key]}
            </MenuItem>
          ))}
        </TextField>
        <IconButton
          aria-label={ascending ? "Absteigend sortieren" : "Aufsteigend sortieren"}
          onClick={() => onChange(toggleSortDirection(sort))}
          sx={{ width: 44, height: 44 }}
        >
          {ascending ? <ArrowUpward aria-hidden /> : <ArrowDownward aria-hidden />}
        </IconButton>
      </Stack>
      <Card>
        <Box component="ul" aria-label="Positionen" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map((position) => (
            <Box
              component="li"
              key={position.security.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 2,
                py: 1.25,
                minHeight: 44,
                "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" },
              }}
            >
              <SecurityLogo name={position.security.name} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
                  {position.security.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatQuantity(position.quantity)} Stück
                </Typography>
              </Box>
              <Stack spacing={0.5} sx={{ alignItems: "flex-end", ...numeric }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {money(position.value)}
                </Typography>
                <GainLoss position={position} />
              </Stack>
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );
}

/** Open Positions: sortable table from `md`, stacked rows below; both share one sort state. */
export function PositionsTable({ positions }: { positions: PositionRecord[] }) {
  const [sort, setSort] = useState<Sort>(DEFAULT_POSITION_SORT);
  const rows = sortPositions(positions, sort.key, sort.direction);
  const onSort = (key: PositionSortKey) => setSort((current) => nextSort(current, key));
  return (
    <>
      <DesktopTable rows={rows} sort={sort} onSort={onSort} />
      <PhoneList rows={rows} sort={sort} onChange={setSort} />
    </>
  );
}
