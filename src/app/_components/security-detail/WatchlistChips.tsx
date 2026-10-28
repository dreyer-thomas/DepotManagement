"use client";

import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import NextLink from "next/link";
import { watchlistHref } from "@/app/_components/watchlists/watchlist-cookie";

/**
 * The watchlists a Security is on, as chips linking to each list (story 9.2); nothing when on none.
 * A client component: `Chip` gets `NextLink` as `component`, a function the server cannot pass.
 */
export function WatchlistChips({ lists }: { lists: readonly { id: string; name: string }[] }) {
  if (lists.length === 0) return null;
  return (
    <Stack component="ul" direction="row" aria-label="Watchlists" sx={{ listStyle: "none", p: 0, m: 0, mt: 0.5, gap: 0.75, flexWrap: "wrap" }}>
      {lists.map((list) => (
        <li key={list.id}>
          <Chip size="small" variant="outlined" color="primary" label={list.name} component={NextLink} href={watchlistHref(list.id)} clickable />
        </li>
      ))}
    </Stack>
  );
}
