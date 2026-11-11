"use client";

import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { breachPillText } from "./labels";

/** A breached mark of a Security as a list shows it: which mark and the date of the Price checked. */
export type PriceMarkBreachInfo = { breach: "stop" | "target"; priceDate: string };

/**
 * Warning icon at a Security with a breached mark (story 12.4, securities list and watchlist table): the
 * tooltip and the accessible name say it in words ("Stopp unterschritten · Kurs vom 10.11.2026");
 * keyboard-focusable, opens on tap. A click does not reach a clickable row around it.
 */
export function PriceMarkWarning({ info }: { info: PriceMarkBreachInfo }) {
  const text = breachPillText(info.breach, info.priceDate);
  return (
    <Tooltip title={text} enterTouchDelay={0}>
      <Box
        component="span"
        role="img"
        aria-label={text}
        tabIndex={0}
        data-price-mark-warning=""
        onClick={(event) => event.stopPropagation()}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          verticalAlign: "middle",
          color: "stale.main",
          borderRadius: 1,
          "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "stale.main", outlineOffset: 2 },
        }}
      >
        <WarningAmberOutlined aria-hidden fontSize="small" />
      </Box>
    </Tooltip>
  );
}
