"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ReactNode, useState } from "react";

/** One list entry: its rendered `<li>`, the text a search query is matched against, and whether "Nur Probleme" keeps it. */
export type SecuritySearchItem = { id: string; text: string; problem: boolean; node: ReactNode };

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
 * symbol, type) as you type; the switch "Nur Probleme (n)" keeps only entries with a price problem (both
 * filters combine); "Keine Wertpapiere gefunden." when nothing matches. The entries are rendered by the
 * server and passed in as nodes.
 */
export function SecuritySearch({ items }: { items: SecuritySearchItem[] }) {
  const [query, setQuery] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const problems = items.filter((item) => item.problem).length;
  const visible = items.filter((item) => (!problemsOnly || item.problem) && matchesSearch(item.text, query));
  return (
    <>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 2, rowGap: 1, mb: 2 }}>
        <TextField
          type="search"
          label="Wertpapiere durchsuchen"
          placeholder="Name, ISIN oder Symbol"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          size="small"
          sx={{ flex: "1 1 240px" }}
          slotProps={{ htmlInput: { autoComplete: "off", enterKeyHint: "search" } }}
        />
        <FormControlLabel
          control={<Switch checked={problemsOnly} onChange={(event) => setProblemsOnly(event.target.checked)} />}
          label={`Nur Probleme (${problems})`}
          sx={{ mr: 0, minHeight: 44 }}
        />
      </Stack>
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
