/** Depot detail tabs, driven by `?tab=`. Story 1.5 switches the default to `positions`. */
export const DEPOT_TABS = [
  { value: "positions", label: "Positionen" },
  { value: "cash", label: "Cash-Konto" },
  { value: "transactions", label: "Buchungen" },
] as const;

export type DepotTab = (typeof DEPOT_TABS)[number]["value"];

export const DEFAULT_DEPOT_TAB: DepotTab = "transactions";

/** The tab named by a `?tab=` value; unknown or missing values give the default. */
export function depotTab(value: string | string[] | undefined): DepotTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return DEPOT_TABS.some((tab) => tab.value === raw) ? (raw as DepotTab) : DEFAULT_DEPOT_TAB;
}

export const depotTabId = (tab: DepotTab) => `depot-tab-${tab}`;
export const depotTabPanelId = (tab: DepotTab) => `depot-tabpanel-${tab}`;
