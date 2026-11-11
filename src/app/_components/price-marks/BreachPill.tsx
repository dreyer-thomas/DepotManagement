import Box from "@mui/material/Box";

/** Breach pill: text (never colour alone) in the stale-soft / stale colours, shaped like `StaleBadge`. */
export function BreachPill({ children }: { children: string }) {
  return (
    <Box
      component="span"
      data-breach-pill=""
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.25,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        bgcolor: "stale.soft",
        color: "stale.main",
      }}
    >
      {children}
    </Box>
  );
}
