import Box from "@mui/material/Box";

/**
 * Button text that is `short` below `sm` (phones) and `full` from `sm`. Give the button `full` as its
 * `aria-label`, so the accessible name stays the same and contains the visible text.
 */
export function ResponsiveLabel({ full, short }: { full: string; short: string }) {
  return (
    <>
      <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
        {short}
      </Box>
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        {full}
      </Box>
    </>
  );
}
