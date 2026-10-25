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

/** Themed client-side link to an app route, for server components (they cannot pass `NextLink` as a prop). */
export function AppLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <MuiLink component={NextLink} href={href} underline="hover">
      {children}
    </MuiLink>
  );
}
