"use client";

import Add from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Fab from "@mui/material/Fab";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState } from "react";
import type { SecuritySummary } from "@/modules/ledger";
import { BOTTOM_NAV_HEIGHT } from "../AppShell";
import { type DialogDepot, TransactionDialog } from "../transactions/TransactionDialog";

const MENU_ID = "new-transaction-depot-menu";

/**
 * Phone-only FAB "+" (hidden from `md`), fixed bottom-right above the bottom navigation. With one Depot
 * it opens "Neue Buchung" for it; with several it first asks "Depot wählen".
 */
export function NewTransactionFab({
  depots,
  securities,
  today,
}: {
  depots: readonly DialogDepot[];
  securities: SecuritySummary[];
  today: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [depot, setDepot] = useState<DialogDepot | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  const start = (chosen: DialogDepot) => {
    setAnchor(null);
    setDepot(chosen);
    setSession((value) => value + 1);
    setOpen(true);
  };

  if (depots.length === 0) return null;
  const single = depots.length === 1;
  return (
    <>
      {/* Phone-only room (FAB height + 16 px) so the end of the page scrolls clear of the FAB. */}
      <Box aria-hidden sx={{ display: { xs: "block", md: "none" }, height: 72 }} />
      <Fab
        color="primary"
        aria-label="Neue Buchung"
        aria-haspopup={single ? "dialog" : "menu"}
        aria-controls={!single && anchor ? MENU_ID : undefined}
        aria-expanded={!single && anchor ? "true" : undefined}
        onClick={(event) => (single ? start(depots[0]) : setAnchor(event.currentTarget))}
        sx={{
          display: { xs: "inline-flex", md: "none" },
          position: "fixed",
          right: 16,
          bottom: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px) + 16px)`,
          zIndex: (theme) => theme.zIndex.appBar + 1,
        }}
      >
        <Add aria-hidden />
      </Fab>
      {single ? null : (
        <Menu
          id={MENU_ID}
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={() => setAnchor(null)}
          slotProps={{ list: { "aria-labelledby": `${MENU_ID}-title` } }}
        >
          <ListSubheader id={`${MENU_ID}-title`}>Depot wählen</ListSubheader>
          {depots.map((item) => (
            <MenuItem key={item.id} sx={{ minHeight: 44 }} onClick={() => start(item)}>
              {item.name}
            </MenuItem>
          ))}
        </Menu>
      )}
      {depot ? (
        <TransactionDialog
          open={open}
          onClose={() => setOpen(false)}
          formKey={session}
          depot={depot}
          securities={securities}
          today={today}
        />
      ) : null}
    </>
  );
}
