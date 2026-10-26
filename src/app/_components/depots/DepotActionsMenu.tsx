"use client";

import MoreVert from "@mui/icons-material/MoreVert";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import NextLink from "next/link";
import { useState } from "react";

/** The Depot detail's ⋮ menu ("Depot-Aktionen"): "Depot abgleichen". Only for non-archived Depots. */
export function DepotActionsMenu({ depotId }: { depotId: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = "depot-actions";
  return (
    <>
      <IconButton
        aria-label="Depot-Aktionen"
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? "true" : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ width: 44, height: 44 }}
      >
        <MoreVert aria-hidden />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          component={NextLink}
          href={`/depots/${encodeURIComponent(depotId)}/reconcile`}
          onClick={() => setAnchor(null)}
          sx={{ minHeight: 44 }}
        >
          Depot abgleichen
        </MenuItem>
      </Menu>
    </>
  );
}
