"use client";

import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import NextLink from "next/link";
import { type MouseEvent, useEffect, useLayoutEffect, useState } from "react";
import type { BackParent, BackTarget } from "./back-target";
import { currentBackTarget, ensureCurrentEntry, installHistoryTracking, registerPageLabel, subscribe } from "./history-tracker";

/** Registers `label` (if any) for the current entry; returns nothing to render. */
function useRegisteredLabel(label: string | undefined): void {
  useEffect(() => {
    installHistoryTracking();
    if (label) registerPageLabel(label);
    else ensureCurrentEntry();
  }, [label]);
}

/**
 * "‹ <label>" on its own line above a sub-page's header (story 8.6): returns to the previous different page of this tab
 * by history traversal (`history.go(-steps)`), else links to the logical `parent`. SSR and the first
 * client render show the parent, so hydration matches; the resolved origin replaces it after mount.
 * `self` is the label under which this page appears as another back link's origin.
 */
export function BackLink({ parent, self }: { parent: BackParent; self?: string }) {
  const [target, setTarget] = useState<BackTarget>({ kind: "link", href: parent.href, label: parent.label });
  useRegisteredLabel(self);
  const { href: parentHref, label: parentLabel } = parent;
  // Layout effect: a client-side navigation shows the resolved origin in its first paint, not the parent.
  useLayoutEffect(() => {
    const update = () => setTarget(currentBackTarget({ href: parentHref, label: parentLabel }));
    update();
    return subscribe(update);
  }, [parentHref, parentLabel]);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (target.kind !== "history") return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.go(-target.steps);
  }

  return (
    <MuiLink
      component={NextLink}
      href={target.href}
      onClick={onClick}
      underline="hover"
      aria-label={`Zurück zu ${target.label}`}
      title={`Zurück zu ${target.label}`}
      sx={{
        display: "flex",
        width: "fit-content",
        alignItems: "center",
        minHeight: 44,
        minWidth: 44,
        maxWidth: "100%",
        mt: -1,
        whiteSpace: "nowrap",
      }}
    >
      <Box component="span" aria-hidden sx={{ whiteSpace: "pre", flexShrink: 0 }}>
        {"‹ "}
      </Box>
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
        {target.label}
      </Box>
    </MuiLink>
  );
}

/** For origin-only pages (no back link): registers the page's label, e.g. the selected watchlist's name. */
export function PageLabel({ label }: { label: string }) {
  useRegisteredLabel(label);
  return null;
}
