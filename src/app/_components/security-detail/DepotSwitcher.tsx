"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import NextLink from "next/link";
import { ALL_DEPOTS_LABEL, depotLabel, securityHref } from "./labels";

/**
 * Depot switcher of the Security page: "Alle Depots" (only when a non-archived Depot booked it) plus each
 * booking Depot, as links; the selected one has `aria-current="page"`. Wraps on phones.
 */
export function DepotSwitcher({
  securityId,
  depots,
  selected,
}: {
  securityId: string;
  depots: readonly { id: string; name: string; archived: boolean }[];
  /** Selected Depot id; `null` = "Alle Depots". */
  selected: string | null;
}) {
  const showAll = depots.some((depot) => !depot.archived);
  const items = [
    ...(showAll ? [{ key: "all", label: ALL_DEPOTS_LABEL, href: securityHref(securityId), current: selected === null }] : []),
    ...depots.map((depot) => ({
      key: depot.id,
      label: depotLabel(depot),
      href: securityHref(securityId, depot.id),
      current: selected === depot.id,
    })),
  ];
  return (
    <Stack component="nav" aria-label="Depot" direction="row" sx={{ flexWrap: "wrap", gap: 1, mb: 2 }}>
      {items.map((item) => (
        <Button
          key={item.key}
          component={NextLink}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          variant={item.current ? "contained" : "outlined"}
          size="small"
          sx={{ minHeight: 44, borderRadius: 999, px: 2 }}
        >
          {item.label}
        </Button>
      ))}
    </Stack>
  );
}
