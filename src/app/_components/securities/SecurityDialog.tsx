"use client";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, useId, useState } from "react";

export const TOUCH_TARGET = { minHeight: 44 };

/** Dialog shell of the Securities page: full-screen below `sm`; Esc and a backdrop click close it. */
export function SecurityDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xs" aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {children}
    </Dialog>
  );
}

/** Opens and closes a dialog; each opening remounts the form so old errors and input are gone. */
export function useDialog() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return {
    open,
    session,
    show: () => {
      setSession((value) => value + 1);
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}
