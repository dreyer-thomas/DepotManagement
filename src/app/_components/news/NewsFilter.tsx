"use client";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { ALL_SECURITIES_LABEL, newsHref } from "./labels";

/** "Wertpapier" filter: navigates to `/news?security=<id>`, or `/news` for "Alle Wertpapiere". */
export function NewsFilter({
  securities,
  selected,
}: {
  securities: readonly { id: string; name: string }[];
  selected: string | undefined;
}) {
  const router = useRouter();
  const value = selected !== undefined && securities.some((security) => security.id === selected) ? selected : "";
  return (
    <TextField
      select
      label="Wertpapier"
      value={value}
      onChange={(event) => router.push(newsHref(event.target.value || undefined))}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      sx={{ mb: 2, width: { xs: "100%", sm: 360 } }}
    >
      <MenuItem value="" sx={{ minHeight: 44 }}>
        {ALL_SECURITIES_LABEL}
      </MenuItem>
      {securities.map((security) => (
        <MenuItem key={security.id} value={security.id} sx={{ minHeight: 44 }}>
          {security.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
