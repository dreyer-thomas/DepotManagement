import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageTitle } from "@/app/_components/Placeholder";
import { CreateWatchlistButton, DeleteWatchlistButton, RenameWatchlistButton } from "@/app/_components/watchlists/WatchlistDialogs";
import { AddWatchlistEntryButton } from "@/app/_components/watchlists/WatchlistEntryDialog";
import { WatchlistTable } from "@/app/_components/watchlists/WatchlistTable";
import { WatchlistTabs } from "@/app/_components/watchlists/WatchlistTabs";
import { selectWatchlistId, WATCHLIST_COOKIE } from "@/app/_components/watchlists/watchlist-cookie";
import { businessDate } from "@/core/dates";
import { listSecurities } from "@/modules/ledger";
import { watchlistView } from "@/modules/watchlist";

export const metadata: Metadata = { title: "Watchlists" };

type Props = { searchParams?: Promise<{ list?: string | string[] }> };

/**
 * Watchlists: the list from `?list=`, else the last opened one (cookie), else the first; tabs (select on
 * phones) in creation order; toolbar "Wertpapier hinzufügen", rename, delete; empty state "Watchlist
 * anlegen". Figures are computed on read by the watchlist module.
 */
export default async function WatchlistsPage({ searchParams }: Props) {
  const today = businessDate(new Date());
  const requested = (await searchParams)?.list;
  const [lists, securities, cookieStore] = await Promise.all([watchlistView(today), listSecurities(), cookies()]);
  const selectedId = selectWatchlistId(lists, typeof requested === "string" ? requested : null, cookieStore.get(WATCHLIST_COOKIE)?.value);
  const selected = lists.find((list) => list.id === selectedId) ?? null;
  if (!selected) {
    return (
      <>
        <PageTitle>Watchlists</PageTitle>
        <Card>
          <CardContent>
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
              <Typography>Noch keine Watchlist. Lege eine Liste an, um Ideen zu sammeln und ihre Kurse zu verfolgen.</Typography>
              <CreateWatchlistButton />
            </Stack>
          </CardContent>
        </Card>
      </>
    );
  }
  const tabs = lists.map((list) => ({ id: list.id, name: list.name }));
  return (
    <>
      <Stack
        direction="row"
        sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 2, rowGap: 1 }}
      >
        <Typography variant="pageTitle" component="h1">
          Watchlists
        </Typography>
        <CreateWatchlistButton label="Neue Watchlist" variant="outlined" />
      </Stack>
      <WatchlistTabs lists={tabs} selectedId={selected.id} />
      <Stack direction="row" sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 1 }}>
        <AddWatchlistEntryButton watchlistId={selected.id} securities={securities} today={today} />
        <Stack direction="row" sx={{ ml: "auto" }}>
          <RenameWatchlistButton key={`rename-${selected.id}`} watchlist={selected} />
          <DeleteWatchlistButton key={`delete-${selected.id}`} watchlist={{ id: selected.id, name: selected.name, entryCount: selected.entries.length }} />
        </Stack>
      </Stack>
      <WatchlistTable key={selected.id} entries={selected.entries} lists={tabs} today={today} />
    </>
  );
}
