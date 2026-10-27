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
import { isStale } from "@/core/prices";
import type { IsinChangeRecord, PositionRecord, SecuritySummary, SplitRecord } from "@/modules/ledger";
import { IsinChangeDialog } from "../corporate-actions/IsinChangeDialog";
import type { PriceDateInfo } from "../prices/price-labels";
import { PriceDate } from "../prices/StaleBadge";
import { SplitDialog } from "../corporate-actions/SplitDialog";
import { SecurityLink } from "../security-detail/SecurityLink";
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

/** Price date info of a Position for the date line / stale badge; `null` without a price. */
function priceInfo(position: PositionRecord, today: string | undefined): PriceDateInfo | null {
  if (position.priceDate === null || position.priceSource === null) return null;
  return {
    date: position.priceDate,
    source: position.priceSource,
    fetchedAt: position.priceFetchedAt,
    provider: position.priceProvider,
    stale: today !== undefined && isStale(position.priceDate, today),
  };
}

function PositionPriceDate({ position, today }: { position: PositionRecord; today: string | undefined }) {
  const info = priceInfo(position, today);
  return info ? <PriceDate info={info} /> : null;
}

function SecurityName({ securityId, name, depotId }: { securityId: string; name: string; depotId: string | undefined }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
      <SecurityLogo securityId={securityId} name={name} />
      <Typography component="span" variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
        <SecurityLink securityId={securityId} depotId={depotId}>
          {name}
        </SecurityLink>
      </Typography>
    </Stack>
  );
}

type Sort = PositionSort;

/** Opens the corporate-action dialog of a Security; `null` when the table is read-only. */
type CorporateActionKind = "split" | "isin-change";

type OnAction = ((action: CorporateActionKind, security: SecuritySummary) => void) | null;

/** Kebab button with the Position's row menu ("Corporate Action → Split"). */
function RowActions({
  security,
  onAction,
}: {
  security: SecuritySummary;
  onAction: (action: CorporateActionKind, security: SecuritySummary) => void;
}) {
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
            onAction("split", security);
          }}
        >
          Corporate Action → Split
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchor(null);
            onAction("isin-change", security);
          }}
        >
          Corporate Action → ISIN-Wechsel
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
  depotId,
  cashBalance,
  today,
  sort,
  onSort,
  onAction,
}: {
  rows: PositionRecord[];
  depotId: string | undefined;
  cashBalance: string;
  today: string | undefined;
  sort: Sort;
  onSort: (key: PositionSortKey) => void;
  onAction: OnAction;
}) {
  const columns = POSITION_SORT_KEYS.length + (onAction ? 1 : 0);
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
            {onAction ? (
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
                <SecurityName securityId={position.security.id} name={position.security.name} depotId={depotId} />
              </TableCell>
              <TableCell sx={numeric}>{formatQuantity(position.quantity)}</TableCell>
              <TableCell sx={numeric}>{formatMoney(position.costBasis)}</TableCell>
              <TableCell sx={numeric}>{formatMoney(position.averagePrice)}</TableCell>
              <TableCell sx={numeric}>
                {position.price === null ? (
                  MISSING
                ) : (
                  <Stack spacing={0.25} sx={{ alignItems: "flex-end" }}>
                    <span>{money(position.price)}</span>
                    <PositionPriceDate position={position} today={today} />
                  </Stack>
                )}
              </TableCell>
              <TableCell sx={numeric}>{money(position.value)}</TableCell>
              <TableCell sx={numeric}>
                <GainLoss position={position} />
              </TableCell>
              {onAction ? (
                <TableCell padding="none">
                  <RowActions security={position.security} onAction={onAction} />
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
            {onAction ? <TableCell padding="none" /> : null}
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

function PhoneList({
  rows,
  depotId,
  cashBalance,
  today,
  sort,
  onChange,
  onAction,
}: {
  rows: PositionRecord[];
  depotId: string | undefined;
  cashBalance: string;
  today: string | undefined;
  sort: Sort;
  onChange: (sort: Sort) => void;
  onAction: OnAction;
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
            <Box component="li" key={position.security.id} sx={{ px: 2, py: 1.25, minHeight: 44, borderBottom: 1, borderColor: "divider" }}>
              {/* Line 1: logo and the full-width name (wraps), row menu. */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <SecurityLogo securityId={position.security.id} name={position.security.name} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: "anywhere" }}>
                  <SecurityLink securityId={position.security.id} depotId={depotId}>
                    {position.security.name}
                  </SecurityLink>
                </Typography>
                {onAction ? <RowActions security={position.security} onAction={onAction} /> : null}
              </Box>
              {/* Line 2, under the name: quantity and price date left, value and Gain/Loss right. */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, pl: 5.5 }}>
                <Stack direction="row" sx={{ flex: 1, minWidth: 0, alignItems: "center", columnGap: 1, rowGap: 0.5, flexWrap: "wrap" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatQuantity(position.quantity)} Stück
                  </Typography>
                  <PositionPriceDate position={position} today={today} />
                </Stack>
                <Stack spacing={0.5} sx={{ flexShrink: 0, alignItems: "flex-end", ...numeric }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {money(position.value)}
                  </Typography>
                  <GainLoss position={position} />
                </Stack>
              </Box>
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
 * ("Corporate Action → Split" / "→ ISIN-Wechsel" open the split or ISIN-change dialog of its
 * Security) unless `readOnly`. The price shows its date below it; with `today` a price older than 3
 * days shows the stale badge instead (`core.isStale`).
 */
export function PositionsTable({
  positions,
  depotId,
  cashBalance,
  today,
  splits = [],
  isinChanges = [],
  securities = [],
  readOnly = false,
  initialSort = DEFAULT_POSITION_SORT,
}: {
  positions: PositionRecord[];
  /** The Depot of the Positions: Security names link to its Security page with it selected. */
  depotId?: string;
  cashBalance: string;
  /** Today's business date for the stale check; without it no price is flagged stale. */
  today?: string;
  /** Recorded splits (any Security), listed in the split dialog. */
  splits?: SplitRecord[];
  /** Recorded ISIN changes (any Security), listed in the ISIN-change dialog. */
  isinChanges?: IsinChangeRecord[];
  /** Every Security, offered as the new Security of an ISIN change. */
  securities?: SecuritySummary[];
  /** Archived Depot: no row menu. */
  readOnly?: boolean;
  /** Sort on first render (value descending by default). */
  initialSort?: Sort;
}) {
  const [sort, setSort] = useState<Sort>(initialSort);
  const [dialog, setDialog] = useState<{ action: CorporateActionKind; security: SecuritySummary } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [session, setSession] = useState(0);
  const rows = sortPositions(positions, sort.key, sort.direction);
  const onSort = (key: PositionSortKey) => setSort((current) => nextSort(current, key));
  const onAction: OnAction = readOnly
    ? null
    : (action, security) => {
        setDialog({ action, security });
        setSession((value) => value + 1);
        setDialogOpen(true);
      };
  return (
    <>
      <DesktopTable rows={rows} depotId={depotId} cashBalance={cashBalance} today={today} sort={sort} onSort={onSort} onAction={onAction} />
      <PhoneList rows={rows} depotId={depotId} cashBalance={cashBalance} today={today} sort={sort} onChange={setSort} onAction={onAction} />
      {dialog?.action === "split" && !readOnly ? (
        <SplitDialog
          key={session}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          security={dialog.security}
          splits={splits}
        />
      ) : null}
      {dialog?.action === "isin-change" && !readOnly ? (
        <IsinChangeDialog
          key={session}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          security={dialog.security}
          isinChanges={isinChanges}
          securities={securities}
        />
      ) : null}
    </>
  );
}
