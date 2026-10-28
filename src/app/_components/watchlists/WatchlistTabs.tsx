"use client";

import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { storeLastWatchlist, watchlistHref } from "./watchlist-cookie";

export type WatchlistTab = { id: string; name: string };

/**
 * The lists in creation order: tabs from `sm` (each a link to `?list=<id>`), a select below. The shown
 * list is remembered in the `dm_watchlist` cookie, so a later visit without `?list=` opens it again.
 */
export function WatchlistTabs({ lists, selectedId }: { lists: readonly WatchlistTab[]; selectedId: string }) {
  const router = useRouter();
  useEffect(() => {
    storeLastWatchlist(selectedId);
  }, [selectedId]);
  return (
    <>
      <Tabs
        value={selectedId}
        aria-label="Watchlists"
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2, display: { xs: "none", sm: "flex" } }}
      >
        {lists.map((list) => (
          <Tab
            key={list.id}
            value={list.id}
            label={list.name}
            component={NextLink}
            href={watchlistHref(list.id)}
            scroll={false}
            sx={{ minHeight: 48, textTransform: "none" }}
          />
        ))}
      </Tabs>
      <Box sx={{ mb: 2, display: { xs: "block", sm: "none" } }}>
        <TextField
          select
          size="small"
          label="Watchlist"
          value={selectedId}
          onChange={(event) => router.push(watchlistHref(event.target.value), { scroll: false })}
          fullWidth
          sx={{ "& .MuiInputBase-root": { minHeight: 44 } }}
        >
          {lists.map((list) => (
            <MenuItem key={list.id} value={list.id} sx={{ minHeight: 44 }}>
              {list.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>
    </>
  );
}
