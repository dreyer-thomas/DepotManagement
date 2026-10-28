"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { Fragment, useState } from "react";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import { EditWatchlistEntryDialog, type EditableWatchlistEntry } from "@/app/_components/watchlists/WatchlistEntryDialog";
import { VIA_CLAUDE_LABEL } from "@/app/_components/watchlists/labels";
import { formatDate } from "@/core/format";
import { percentOrMissing, ratioTone } from "./labels";
import { watchlistHref } from "./WatchlistChips";

/** An entry of this Security as the card shows it (`securityWatchlistEntries`). */
export type WatchlistCardEntry = {
  id: string;
  watchlistId: string;
  watchlistName: string;
  note: string;
  dateAdded: string;
  source: "APP" | "MCP";
  sinceAdded: string | null;
};

export const WATCHLIST_CARD_HEADING = "Auf Watchlists";

/**
 * "Auf Watchlists" (story 9.2, watch layout): per entry the list (link to it), date added, change since
 * added ("–" without a Price), the full note (line breaks kept), "via Claude" for MCP entries and
 * "Bearbeiten" opening the watchlist's "Eintrag bearbeiten" dialog. Nothing when on no list.
 */
export function WatchlistCard({
  entries,
  lists,
  security,
  today,
}: {
  entries: readonly WatchlistCardEntry[];
  /** Every watchlist (the edit dialog's list select). */
  lists: readonly { id: string; name: string }[];
  security: { name: string; isin: string | null; cryptoSymbol: string | null };
  today: string;
}) {
  const [editing, setEditing] = useState<EditableWatchlistEntry | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  if (entries.length === 0) return null;
  const edit = (entry: WatchlistCardEntry) => {
    setEditing({ id: entry.id, watchlistId: entry.watchlistId, note: entry.note, dateAdded: entry.dateAdded, security });
    setEditKey((value) => value + 1);
    setEditOpen(true);
  };
  return (
    <Box component="section" aria-labelledby="security-watchlists" sx={{ mb: 1.5 }}>
      <Card>
        <CardContent>
          <CardHeading id="security-watchlists">{WATCHLIST_CARD_HEADING}</CardHeading>
          <Stack component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
            {entries.map((entry, index) => {
              const tone = ratioTone(entry.sinceAdded);
              return (
                <Fragment key={entry.id}>
                  {index > 0 ? <Divider component="li" aria-hidden sx={{ my: 1.5 }} /> : null}
                  <li>
                    <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.5 }}>
                      <Link component={NextLink} href={watchlistHref(entry.watchlistId)} sx={{ fontWeight: 600 }}>
                        {entry.watchlistName}
                      </Link>
                      {entry.source === "MCP" ? <Chip size="small" variant="outlined" label={VIA_CLAUDE_LABEL} /> : null}
                      <Button
                        size="small"
                        startIcon={<EditOutlined aria-hidden />}
                        onClick={() => edit(entry)}
                        aria-label={`Bearbeiten – ${entry.watchlistName}`}
                        sx={{ ml: "auto", minHeight: 44 }}
                      >
                        Bearbeiten
                      </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      Aufgenommen {formatDate(entry.dateAdded)} · seit Aufnahme{" "}
                      <Box component="span" sx={{ fontWeight: 600, color: tone ? `${tone}.main` : undefined }}>
                        {percentOrMissing(entry.sinceAdded)}
                      </Box>
                    </Typography>
                    {entry.note ? (
                      <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {entry.note}
                      </Typography>
                    ) : null}
                  </li>
                </Fragment>
              );
            })}
          </Stack>
        </CardContent>
      </Card>
      <EditWatchlistEntryDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        formKey={editKey}
        entry={editing}
        lists={lists}
        today={today}
      />
    </Box>
  );
}
