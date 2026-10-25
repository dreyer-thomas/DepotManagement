"use client";

import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import NextLink from "next/link";
import { DEPOT_TABS, type DepotTab, depotTabId, depotTabPanelId } from "./depot-tabs";

/** Tab bar of the Depot detail; each tab is a link to `?tab=<value>` so the URL holds the state. */
export function DepotTabs({ depotId, value }: { depotId: string; value: DepotTab }) {
  return (
    <Tabs value={value} aria-label="Depot-Ansichten" variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
      {DEPOT_TABS.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          id={depotTabId(tab.value)}
          aria-controls={tab.value === value ? depotTabPanelId(tab.value) : undefined}
          component={NextLink}
          href={`/depots/${encodeURIComponent(depotId)}?tab=${tab.value}`}
          scroll={false}
          sx={{ minHeight: 48 }}
        />
      ))}
    </Tabs>
  );
}
