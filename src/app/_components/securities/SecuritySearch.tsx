"use client";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ReactNode, useState } from "react";

/** One list entry: its rendered `<li>` and the text a search query is matched against. */
export type SecuritySearchItem = { id: string; text: string; node: ReactNode };

/** True when every whitespace-separated term of `query` occurs in `text` (case-insensitive); an empty query matches all. */
export function matchesSearch(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase("de-DE");
  return query
    .toLocaleLowerCase("de-DE")
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/**
 * Search field above the Securities list: typing filters the entries (name, ISIN, crypto symbol, price
 * symbol, type) as you type; "Keine Wertpapiere gefunden." when nothing matches. The entries are rendered
 * by the server and passed in as nodes.
 */
export function SecuritySearch({ items }: { items: SecuritySearchItem[] }) {
  const [query, setQuery] = useState("");
  const visible = items.filter((item) => matchesSearch(item.text, query));
  return (
    <>
      <TextField
        type="search"
        label="Wertpapiere durchsuchen"
        placeholder="Name, ISIN oder Symbol"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        fullWidth
        size="small"
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { autoComplete: "off", enterKeyHint: "search" } }}
      />
      {visible.length === 0 ? (
        <Typography color="text.secondary">Keine Wertpapiere gefunden.</Typography>
      ) : (
        <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {visible.map((item) => item.node)}
        </Stack>
      )}
    </>
  );
}
