"use client";

import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useRouter } from "next/navigation";
import type { NewsScope } from "@/modules/news";
import { ALL_SECURITIES_LABEL, NEWS_SCOPE_LABELS, newsHref } from "./labels";

const SCOPES: readonly NewsScope[] = ["all", "held", "watched"];

/**
 * Filters of the news page: the scope toggle "Alle · Depot · Watchlist" (`/news?scope=held|watched`;
 * switching resets the Security) and the "Wertpapier" select of the Securities in that scope
 * (`/news?security=<id>`, "Alle Wertpapiere" clears it).
 */
export function NewsFilter({
  securities,
  selected,
  scope,
}: {
  securities: readonly { id: string; name: string }[];
  selected: string | undefined;
  scope: NewsScope;
}) {
  const router = useRouter();
  const value = selected !== undefined && securities.some((security) => security.id === selected) ? selected : "";
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, mb: 2 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={scope}
        aria-label="Nachrichten zeigen für"
        onChange={(_, next: NewsScope | null) => {
          if (next !== null && next !== scope) router.push(newsHref(undefined, next));
        }}
      >
        {SCOPES.map((option) => (
          <ToggleButton key={option} value={option} sx={{ minHeight: 44, px: 2 }}>
            {NEWS_SCOPE_LABELS[option]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {securities.length > 0 && (
        <TextField
          select
          label="Wertpapier"
          value={value}
          onChange={(event) => router.push(newsHref(event.target.value || undefined, scope))}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          sx={{ width: { xs: "100%", sm: 360 } }}
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
      )}
    </Box>
  );
}
