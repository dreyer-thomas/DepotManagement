"use client";

import MoreVert from "@mui/icons-material/MoreVert";
import IconButton from "@mui/material/IconButton";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState } from "react";
import type { IsinChangeRecord, SecuritySummary, SplitRecord } from "@/modules/ledger";
import { IsinChangeDialog } from "../corporate-actions/IsinChangeDialog";
import { SplitDialog } from "../corporate-actions/SplitDialog";
import { type DialogDepot, TransactionDialog } from "../transactions/TransactionDialog";

const TOUCH_TARGET = { minHeight: 44 };

type Dialog = { kind: "split" } | { kind: "isin-change" } | { kind: "transaction"; depot: DialogDepot };

/**
 * Kebab menu of the Security page ("Aktionen für <name>"): "Split …", "ISIN-Wechsel …" and — when
 * `transactionDepots` is non-empty — "Neue Buchung" with the Security preselected: directly for one
 * Depot, after "Depot wählen" for several.
 */
export function SecurityActions({
  security,
  splits,
  isinChanges,
  securities,
  transactionDepots,
  today,
}: {
  security: SecuritySummary;
  splits: SplitRecord[];
  isinChanges: IsinChangeRecord[];
  securities: SecuritySummary[];
  /** Depots a new Transaction may be booked in (non-archived); empty omits "Neue Buchung". */
  transactionDepots: readonly DialogDepot[];
  today: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [depotAnchor, setDepotAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const menuId = `security-actions-${security.id}`;
  const depotMenuId = `${menuId}-depots`;

  const start = (next: Dialog) => {
    setAnchor(null);
    setDepotAnchor(null);
    setDialog(next);
    setSession((value) => value + 1);
    setOpen(true);
  };
  const close = () => setOpen(false);

  return (
    <>
      <IconButton
        aria-label={`Aktionen für ${security.name}`}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? "true" : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ width: 44, height: 44 }}
      >
        <MoreVert aria-hidden />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem sx={TOUCH_TARGET} onClick={() => start({ kind: "split" })}>
          Split …
        </MenuItem>
        <MenuItem sx={TOUCH_TARGET} onClick={() => start({ kind: "isin-change" })}>
          ISIN-Wechsel …
        </MenuItem>
        {transactionDepots.length > 0 ? (
          <MenuItem
            sx={TOUCH_TARGET}
            aria-haspopup={transactionDepots.length > 1 ? "menu" : "dialog"}
            onClick={() => {
              if (transactionDepots.length === 1) start({ kind: "transaction", depot: transactionDepots[0] });
              else {
                setDepotAnchor(anchor);
                setAnchor(null);
              }
            }}
          >
            Neue Buchung
          </MenuItem>
        ) : null}
      </Menu>
      {transactionDepots.length > 1 ? (
        <Menu
          id={depotMenuId}
          anchorEl={depotAnchor}
          open={Boolean(depotAnchor)}
          onClose={() => setDepotAnchor(null)}
          slotProps={{ list: { "aria-labelledby": `${depotMenuId}-title` } }}
        >
          <ListSubheader id={`${depotMenuId}-title`}>Depot wählen</ListSubheader>
          {transactionDepots.map((depot) => (
            <MenuItem key={depot.id} sx={TOUCH_TARGET} onClick={() => start({ kind: "transaction", depot })}>
              {depot.name}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
      {dialog?.kind === "split" ? (
        <SplitDialog key={session} open={open} onClose={close} security={security} splits={splits} />
      ) : null}
      {dialog?.kind === "isin-change" ? (
        <IsinChangeDialog
          key={session}
          open={open}
          onClose={close}
          security={security}
          isinChanges={isinChanges}
          securities={securities}
        />
      ) : null}
      {dialog?.kind === "transaction" ? (
        <TransactionDialog
          open={open}
          onClose={close}
          formKey={session}
          depot={dialog.depot}
          securities={securities}
          today={today}
          security={security}
        />
      ) : null}
    </>
  );
}
