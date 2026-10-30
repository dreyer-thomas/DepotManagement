"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import Button from "@mui/material/Button";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import { type ReactNode, useId, useState } from "react";
import { TOUCH_TARGET } from "./SecurityDialog";

/**
 * "Bearbeiten" (pencil) of a Security card: a popup holding the card's edit actions (`children`, each a
 * button opening its own dialog). The popup stays mounted, so a dialog opened from it outlives the popup,
 * which closes on any click inside.
 */
export function SecurityEditMenu({ name, children }: { name: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-label={`Bearbeiten – ${name}`}
        aria-haspopup="true"
        aria-expanded={anchor ? "true" : "false"}
        aria-controls={id}
        startIcon={<EditOutlined aria-hidden />}
        sx={TOUCH_TARGET}
      >
        Bearbeiten
      </Button>
      <Popover
        id={id}
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        keepMounted
        disableRestoreFocus
      >
        <Stack
          role="group"
          aria-label={`Bearbeiten – ${name}`}
          onClick={() => setAnchor(null)}
          sx={{ p: 1, gap: 1, minWidth: 220, "& .MuiButton-root": { justifyContent: "flex-start", width: "100%" } }}
        >
          {children}
        </Stack>
      </Popover>
    </>
  );
}
