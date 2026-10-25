"use client";

import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import MoreVert from "@mui/icons-material/MoreVert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
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
import type { PositionRecord, SecuritySummary, SplitRecord } from "@/modules/ledger";
import { SplitDialog } from "../corporate-actions/SplitDialog";
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

/** Opens the corporate-action dialog of a Security; `null` when the table is read-only. */
type OnSplit = ((security: SecuritySummary) => void) | null;

/** Kebab button with the Position's row menu ("Corporate Action → Split"). */
function RowActions({ security, onSplit }: { security: SecuritySummary; onSplit: (security: SecuritySummary) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = `position-actions-${security.id}`;
  return (
    <>
      <IconButton
        aria-label={`Aktionen für ${security.name}`}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? "true" : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ width: 44, height: 44 }}
      >
        <MoreVert aria-hidden />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchor(null);
            onSplit(security);
          }}
        >
          Corporate Action → Split
        </MenuItem>
      </Menu>
    </>
  );
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

const CASH_LABEL = "Cash-Konto";
const NO_POSITIONS = "Keine offenen Positionen.";
/** Pinned Cash row: neutral cash left border and a soft cash tint (DESIGN.md: cash is deliberately neutral). */
const cashRowSx = {
  bgcolor: "color-mix(in srgb, var(--mui-palette-cash-main) 18%, transparent)",
  boxShadow: "inset 4px 0 0 var(--mui-palette-cash-main)",
} as const;

function CashName() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
      <Box
        component="span"
        sx={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        <AccountBalanceWalletOutlined aria-hidden />
      </Box>
      <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
        {CASH_LABEL}
      </Typography>
    </Stack>
  );
}

function DesktopTable({
  rows,
  cashBalance,
  sort,
  onSort,
  onSplit,
}: {
  rows: PositionRecord[];
  cashBalance: string;
  sort: Sort;
  onSort: (key: PositionSortKey) => void;
  onSplit: OnSplit;
}) {
  const columns = POSITION_SORT_KEYS.length + (onSplit ? 1 : 0);
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
            {onSplit ? (
              <TableCell padding="none">
                <span style={visuallyHidden}>Aktionen</span>
              </TableCell>
            ) : null}
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
              {onSplit ? (
                <TableCell padding="none">
                  <RowActions security={position.security} onSplit={onSplit} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns}>{NO_POSITIONS}</TableCell>
            </TableRow>
          ) : null}
          <TableRow sx={{ ...cashRowSx, "& td": { py: 1 } }} data-cash-row="">
            {POSITION_SORT_KEYS.map((key) => (
              <TableCell key={key} sx={key === "name" ? undefined : numeric}>
                {key === "name" ? <CashName /> : key === "value" ? formatMoney(cashBalance) : null}
              </TableCell>
            ))}
            {onSplit ? <TableCell padding="none" /> : null}
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

function PhoneList({
  rows,
  cashBalance,
  sort,
  onChange,
  onSplit,
}: {
  rows: PositionRecord[];
  cashBalance: string;
  sort: Sort;
  onChange: (sort: Sort) => void;
  onSplit: OnSplit;
}) {
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
                borderBottom: 1,
                borderColor: "divider",
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
              {onSplit ? <RowActions security={position.security} onSplit={onSplit} /> : null}
            </Box>
          ))}
          {rows.length === 0 ? (
            <Box component="li" sx={{ px: 2, py: 1.25, minHeight: 44, borderBottom: 1, borderColor: "divider" }}>
              <Typography variant="body2">{NO_POSITIONS}</Typography>
            </Box>
          ) : null}
          <Box
            component="li"
            data-cash-row=""
            sx={{ ...cashRowSx, display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.25, minHeight: 44 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <CashName />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600, ...numeric }}>
              {formatMoney(cashBalance)}
            </Typography>
          </Box>
        </Box>
      </Card>
    </Box>
  );
}

/**
 * Open Positions: sortable table from `md`, stacked rows below; both share one sort state. The Cash
 * Account row is pinned below the sorted rows and never sorted. Each Position has a row menu
 * ("Corporate Action → Split" opens the split dialog of its Security) unless `readOnly`.
 */
export function PositionsTable({
  positions,
  cashBalance,
  splits = [],
  readOnly = false,
  initialSort = DEFAULT_POSITION_SORT,
}: {
  positions: PositionRecord[];
  cashBalance: string;
  /** Recorded splits (any Security), listed in the split dialog. */
  splits?: SplitRecord[];
  /** Archived Depot: no row menu. */
  readOnly?: boolean;
  /** Sort on first render (value descending by default). */
  initialSort?: Sort;
}) {
  const [sort, setSort] = useState<Sort>(initialSort);
  const [splitSecurity, setSplitSecurity] = useState<SecuritySummary | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [session, setSession] = useState(0);
  const rows = sortPositions(positions, sort.key, sort.direction);
  const onSort = (key: PositionSortKey) => setSort((current) => nextSort(current, key));
  const onSplit: OnSplit = readOnly
    ? null
    : (security) => {
        setSplitSecurity(security);
        setSession((value) => value + 1);
        setSplitOpen(true);
      };
  return (
    <>
      <DesktopTable rows={rows} cashBalance={cashBalance} sort={sort} onSort={onSort} onSplit={onSplit} />
      <PhoneList rows={rows} cashBalance={cashBalance} sort={sort} onChange={setSort} onSplit={onSplit} />
      {splitSecurity && !readOnly ? (
        <SplitDialog
          key={session}
          open={splitOpen}
          onClose={() => setSplitOpen(false)}
          security={splitSecurity}
          splits={splits}
        />
      ) : null}
    </>
  );
}
