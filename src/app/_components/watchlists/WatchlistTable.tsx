"use client";

import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import EditOutlined from "@mui/icons-material/EditOutlined";
import ViewColumnOutlined from "@mui/icons-material/ViewColumnOutlined";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExactDecimal } from "@/core/decimal";
import { formatDate, formatFigure, formatMoney, formatPercent, formatRate } from "@/core/format";
import {
  DEFAULT_WATCHLIST_SORT,
  firstNoteLine,
  sortWatchlistEntries,
  WATCHLIST_SORT_KEYS,
  type WatchlistSort,
  type WatchlistSortKey,
} from "@/core/watchlist";
import type { WatchlistEntryView } from "@/modules/watchlist";
import type { PriceDateInfo } from "../prices/price-labels";
import { PriceDate } from "../prices/StaleBadge";
import { SecurityLink } from "../security-detail/SecurityLink";
import { securityHref } from "../security-detail/labels";
import { SecurityLogo } from "../securities/SecurityLogo";
import { EditWatchlistEntryDialog, type EditableWatchlistEntry } from "./WatchlistEntryDialog";
import { HELD_LABEL, initialWatchlistSortDirection, VIA_CLAUDE_LABEL, WATCHLIST_SORT_LABELS } from "./labels";
import { storeWatchlistColumns, WATCHLIST_COLUMN_KEYS, type WatchlistColumnKey } from "./watchlist-cookie";

const MISSING = "–";
const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/** Tone of a ratio as displayed (2 decimals in %): `null` when it shows as 0,00 %. */
function ratioTone(ratio: string): "gain" | "loss" | null {
  const shown = new ExactDecimal(ratio).times(100).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
  if (shown.isZero()) return null;
  return shown.isNegative() ? "loss" : "gain";
}

/** A signed percentage (sign in the text, color as a second cue); "–" without a value. */
function Ratio({ ratio }: { ratio: string | null }) {
  if (ratio === null) return <span>{MISSING}</span>;
  const tone = ratioTone(ratio);
  return (
    <Box component="span" sx={{ color: tone ? `${tone}.main` : "text.secondary", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
      {formatPercent(ratio)}
    </Box>
  );
}

/** Change today: "+1,23 %" over "+0,50 €" (per unit); "–" without a previous Price. */
function ChangeToday({ entry, align = "flex-end" }: { entry: WatchlistEntryView; align?: "flex-end" | "flex-start" }) {
  if (entry.changeToday === null) return <span>{MISSING}</span>;
  return (
    <Stack spacing={0.25} sx={{ alignItems: align }}>
      <Ratio ratio={entry.changeToday.ratio} />
      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {formatMoney(entry.changeToday.perUnit, { sign: true })}
      </Typography>
    </Stack>
  );
}

function priceInfo(entry: WatchlistEntryView): PriceDateInfo | null {
  if (entry.priceDate === null || entry.priceSource === null) return null;
  return { date: entry.priceDate, source: entry.priceSource, fetchedAt: entry.priceFetchedAt, provider: entry.priceProvider, stale: entry.stale };
}

function Price({ entry, align = "flex-end" }: { entry: WatchlistEntryView; align?: "flex-end" | "flex-start" }) {
  const info = priceInfo(entry);
  if (entry.price === null || info === null) return <span>{MISSING}</span>;
  return (
    <Stack spacing={0.25} sx={{ alignItems: align }}>
      <span>{formatMoney(entry.price)}</span>
      <PriceDate info={info} />
    </Stack>
  );
}

function Chips({ entry }: { entry: WatchlistEntryView }) {
  if (!entry.held && entry.source !== "MCP") return null;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
      {entry.held ? <Chip size="small" label={HELD_LABEL} color="primary" variant="outlined" /> : null}
      {entry.source === "MCP" ? <Chip size="small" label={VIA_CLAUDE_LABEL} variant="outlined" /> : null}
    </Stack>
  );
}

/** Logo, name (link to the Security detail), ISIN / symbol and the chips. */
function SecurityCell({ entry }: { entry: WatchlistEntryView }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
      <SecurityLogo securityId={entry.security.id} name={entry.security.name} />
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography component="span" variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
          <SecurityLink securityId={entry.security.id} stopPropagation>
            {entry.security.name}
          </SecurityLink>
        </Typography>
        <Typography component="span" variant="caption" color="text.secondary">
          {entry.security.isin ?? entry.security.cryptoSymbol ?? ""}
        </Typography>
        <Chips entry={entry} />
      </Stack>
    </Stack>
  );
}

function EditButton({ entry, onEdit }: { entry: WatchlistEntryView; onEdit: (entry: WatchlistEntryView) => void }) {
  return (
    <IconButton
      aria-label={`${entry.security.name} bearbeiten`}
      title="Bearbeiten"
      onClick={(event) => {
        event.stopPropagation();
        onEdit(entry);
      }}
      sx={{ width: 44, height: 44 }}
    >
      <EditOutlined aria-hidden />
    </IconButton>
  );
}

/** The provider key figures a watchlist column shows (from the Security's snapshot; `null` = not delivered). */
export type WatchlistKeyFigures = { trailingPE: string | null; dividendYield: string | null };

/** Column header / menu label of each optional column. */
const COLUMN_LABELS: Record<WatchlistColumnKey, string> = {
  kgv: "KGV",
  dividendYield: "Dividendenrendite",
  distanceToHigh: "Abstand zum 52-Wochen-Hoch",
};

/** Short label of each optional column in the phone row's caption line. */
const PHONE_LABELS: Record<WatchlistColumnKey, string> = {
  kgv: "KGV",
  dividendYield: "Dividendenrendite",
  distanceToHigh: "Abstand zum Hoch",
};

/** The displayed value of an optional column; "–" when not delivered or not computable. */
function columnValue(key: WatchlistColumnKey, entry: WatchlistEntryView, figures: WatchlistKeyFigures | undefined): string {
  switch (key) {
    case "kgv":
      return figures?.trailingPE ? formatFigure(figures.trailingPE) : MISSING;
    case "dividendYield":
      return figures?.dividendYield ? formatRate(figures.dividendYield) : MISSING;
    case "distanceToHigh":
      return entry.fiftyTwoWeek.distanceToHigh === null ? MISSING : formatRate(entry.fiftyTwoWeek.distanceToHigh);
  }
}

/** "Spalten": a menu of checkboxes that shows or hides the optional key-figure columns. */
function ColumnMenu({ columns, onToggle }: { columns: readonly WatchlistColumnKey[]; onToggle: (key: WatchlistColumnKey) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        aria-label="Spalten"
        title="Spalten"
        aria-haspopup="menu"
        aria-expanded={anchor ? "true" : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ width: 44, height: 44 }}
      >
        <ViewColumnOutlined aria-hidden />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {WATCHLIST_COLUMN_KEYS.map((key) => {
          const checked = columns.includes(key);
          return (
            <MenuItem key={key} role="menuitemcheckbox" aria-checked={checked} onClick={() => onToggle(key)} sx={{ minHeight: 44 }}>
              <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple slotProps={{ input: { "aria-hidden": true } }} sx={{ py: 0 }} />
              <ListItemText>{COLUMN_LABELS[key]}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

const rowLink = { cursor: "pointer", "&:hover": { bgcolor: "action.hover" } } as const;

function DesktopTable({
  rows,
  sort,
  onSort,
  onOpen,
  onEdit,
  columns,
  keyFigures,
}: {
  rows: WatchlistEntryView[];
  columns: readonly WatchlistColumnKey[];
  keyFigures: Readonly<Record<string, WatchlistKeyFigures>>;
  sort: WatchlistSort;
  onSort: (key: WatchlistSortKey) => void;
  onOpen: (entry: WatchlistEntryView) => void;
  onEdit: (entry: WatchlistEntryView) => void;
}) {
  const sortHeader = (key: WatchlistSortKey) => {
    const active = sort.key === key;
    return (
      <TableCell key={key} sx={key === "name" ? undefined : numeric} sortDirection={active ? sort.direction : false}>
        <TableSortLabel
          active={active}
          direction={active ? sort.direction : initialWatchlistSortDirection(key)}
          onClick={() => onSort(key)}
          sx={{ minHeight: 44 }}
        >
          {WATCHLIST_SORT_LABELS[key]}
        </TableSortLabel>
      </TableCell>
    );
  };
  return (
    <Card sx={{ overflowX: "auto", display: { xs: "none", md: "block" } }}>
      <Table size="small" aria-label="Watchlist-Einträge">
        <TableHead>
          <TableRow>
            {sortHeader("name")}
            <TableCell sx={numeric}>Kurs</TableCell>
            {sortHeader("changeToday")}
            {sortHeader("sinceAdded")}
            {columns.map((key) => (
              <TableCell key={key} sx={numeric}>
                {COLUMN_LABELS[key]}
              </TableCell>
            ))}
            {sortHeader("dateAdded")}
            <TableCell>Notiz</TableCell>
            <TableCell padding="none">
              <Box component="span" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Aktionen
              </Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((entry) => (
            <TableRow key={entry.id} data-entry-row="" onClick={() => onOpen(entry)} sx={{ ...rowLink, "& td": { py: 1 } }}>
              <TableCell>
                <SecurityCell entry={entry} />
              </TableCell>
              <TableCell sx={numeric}>
                <Price entry={entry} />
              </TableCell>
              <TableCell sx={numeric}>
                <ChangeToday entry={entry} />
              </TableCell>
              <TableCell sx={numeric}>
                <Ratio ratio={entry.sinceAdded} />
              </TableCell>
              {columns.map((key) => (
                <TableCell key={key} sx={numeric}>
                  {columnValue(key, entry, keyFigures[entry.securityId])}
                </TableCell>
              ))}
              <TableCell sx={numeric}>{formatDate(entry.dateAdded)}</TableCell>
              <TableCell sx={{ maxWidth: 240 }}>
                <Typography variant="body2" color="text.secondary" noWrap title={firstNoteLine(entry.note)}>
                  {firstNoteLine(entry.note)}
                </Typography>
              </TableCell>
              <TableCell padding="none">
                <EditButton entry={entry} onEdit={onEdit} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function PhoneList({
  rows,
  sort,
  onChange,
  onOpen,
  onEdit,
  columns,
  keyFigures,
}: {
  rows: WatchlistEntryView[];
  columns: readonly WatchlistColumnKey[];
  keyFigures: Readonly<Record<string, WatchlistKeyFigures>>;
  sort: WatchlistSort;
  onChange: (sort: WatchlistSort) => void;
  onOpen: (entry: WatchlistEntryView) => void;
  onEdit: (entry: WatchlistEntryView) => void;
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
          onChange={(event) => {
            const key = event.target.value as WatchlistSortKey;
            onChange({ key, direction: initialWatchlistSortDirection(key) });
          }}
          sx={{ minWidth: 180, "& .MuiInputBase-root": { minHeight: 44 } }}
        >
          {WATCHLIST_SORT_KEYS.map((key) => (
            <MenuItem key={key} value={key}>
              {WATCHLIST_SORT_LABELS[key]}
            </MenuItem>
          ))}
        </TextField>
        <IconButton
          aria-label={ascending ? "Absteigend sortieren" : "Aufsteigend sortieren"}
          onClick={() => onChange({ key: sort.key, direction: ascending ? "desc" : "asc" })}
          sx={{ width: 44, height: 44 }}
        >
          {ascending ? <ArrowUpward aria-hidden /> : <ArrowDownward aria-hidden />}
        </IconButton>
      </Stack>
      <Card>
        <Box component="ul" aria-label="Watchlist-Einträge" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map((entry) => (
            <Box
              component="li"
              key={entry.id}
              data-entry-row=""
              onClick={() => onOpen(entry)}
              sx={{ ...rowLink, px: 2, py: 1.25, minHeight: 44, borderBottom: 1, borderColor: "divider" }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <SecurityCell entry={entry} />
                </Box>
                <EditButton entry={entry} onEdit={onEdit} />
              </Box>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mt: 0.5, pl: 5.5 }}>
                <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Price entry={entry} align="flex-start" />
                  <Typography variant="caption" color="text.secondary">
                    Aufgenommen {formatDate(entry.dateAdded)} · seit Aufnahme <Ratio ratio={entry.sinceAdded} />
                  </Typography>
                  {columns.length > 0 ? (
                    <Typography variant="caption" color="text.secondary" data-key-figures="">
                      {columns.map((key) => `${PHONE_LABELS[key]} ${columnValue(key, entry, keyFigures[entry.securityId])}`).join(" · ")}
                    </Typography>
                  ) : null}
                  {entry.note ? (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {firstNoteLine(entry.note)}
                    </Typography>
                  ) : null}
                </Stack>
                <Box sx={{ flexShrink: 0, ...numeric }}>
                  <ChangeToday entry={entry} />
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );
}

/**
 * Entries of one watchlist: sortable table from `md`, stacked rows below (one shared sort state, default
 * date added newest first, `sortWatchlistEntries`). A row opens the Security detail; the pencil opens
 * "Eintrag bearbeiten" (note, date, list, "Entfernen"). "Spalten" shows the optional key-figure columns
 * (KGV, Dividendenrendite, Abstand zum 52-Wochen-Hoch; not sortable), remembered per browser; on phones
 * the chosen figures form an extra caption line of each row.
 */
export function WatchlistTable({
  entries,
  lists,
  today,
  initialSort = DEFAULT_WATCHLIST_SORT,
  keyFigures = {},
  initialColumns = [],
}: {
  entries: WatchlistEntryView[];
  /** Every list, offered as the target of a move. */
  lists: readonly { id: string; name: string }[];
  today: string;
  initialSort?: WatchlistSort;
  /** Provider key figures per Security id (absent = no snapshot). */
  keyFigures?: Readonly<Record<string, WatchlistKeyFigures>>;
  /** The optional columns shown at first (from the cookie). */
  initialColumns?: readonly WatchlistColumnKey[];
}) {
  const router = useRouter();
  const [sort, setSort] = useState<WatchlistSort>(initialSort);
  const [columns, setColumns] = useState<readonly WatchlistColumnKey[]>(initialColumns);
  const toggleColumn = (key: WatchlistColumnKey) => {
    const next = WATCHLIST_COLUMN_KEYS.filter((candidate) => (candidate === key ? !columns.includes(key) : columns.includes(candidate)));
    setColumns(next);
    storeWatchlistColumns(next);
  };
  const [editing, setEditing] = useState<EditableWatchlistEntry | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const rows = sortWatchlistEntries(entries, sort.key, sort.direction);
  const open = (entry: WatchlistEntryView) => router.push(securityHref(entry.security.id));
  const edit = (entry: WatchlistEntryView) => {
    setEditing(entry);
    setEditKey((value) => value + 1);
    setEditOpen(true);
  };
  const onSort = (key: WatchlistSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: initialWatchlistSortDirection(key) },
    );
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography>Noch keine Wertpapiere auf dieser Watchlist.</Typography>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 0.5 }}>
        <ColumnMenu columns={columns} onToggle={toggleColumn} />
      </Stack>
      <DesktopTable rows={rows} sort={sort} onSort={onSort} onOpen={open} onEdit={edit} columns={columns} keyFigures={keyFigures} />
      <PhoneList rows={rows} sort={sort} onChange={setSort} onOpen={open} onEdit={edit} columns={columns} keyFigures={keyFigures} />
      <EditWatchlistEntryDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        formKey={editKey}
        entry={editing}
        lists={lists}
        today={today}
      />
    </>
  );
}
