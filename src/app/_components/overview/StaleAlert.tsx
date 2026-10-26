import Box from "@mui/material/Box";
import { AppLink } from "../depots/DepotLink";
import { staleAlertText } from "./labels";

/**
 * Stale prices Alert above the hero: `Kurse für N Wertpapiere veraltet.` with a link to the Securities.
 * Stale colors carry the tone, the text the meaning. Nothing when `count` is 0.
 */
export function StaleAlert({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <Box
      role="status"
      sx={{
        mb: 2,
        px: 2,
        py: 1.25,
        borderRadius: 3,
        fontSize: 14,
        bgcolor: "stale.soft",
        color: "stale.main",
        "& a": { color: "stale.main", fontWeight: 600, textDecorationColor: "currentColor" },
      }}
    >
      {staleAlertText(count)} <AppLink href="/securities">Wertpapiere ansehen</AppLink>
    </Box>
  );
}
