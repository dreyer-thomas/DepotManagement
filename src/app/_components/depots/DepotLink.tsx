"use client";

import MuiLink from "@mui/material/Link";
import NextLink from "next/link";
import type { ReactNode } from "react";

/** Themed client-side link to a Depot's detail page. */
export function DepotLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <MuiLink component={NextLink} href={`/depots/${encodeURIComponent(id)}`} underline="hover" color="inherit">
      {children}
    </MuiLink>
  );
}
