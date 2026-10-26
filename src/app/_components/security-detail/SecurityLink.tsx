"use client";

import MuiLink from "@mui/material/Link";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { securityHref } from "./labels";

/**
 * Link to a Security's detail page (optionally with a Depot selected), in the surrounding text color.
 * `stopPropagation` keeps a click from reaching a clickable row around it.
 */
export function SecurityLink({
  securityId,
  depotId,
  stopPropagation = false,
  children,
}: {
  securityId: string;
  depotId?: string | null;
  stopPropagation?: boolean;
  children: ReactNode;
}) {
  return (
    <MuiLink
      component={NextLink}
      href={securityHref(securityId, depotId)}
      underline="hover"
      color="inherit"
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      {children}
    </MuiLink>
  );
}
