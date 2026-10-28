import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import DonutSmallOutlined from "@mui/icons-material/DonutSmallOutlined";
import FileUploadOutlined from "@mui/icons-material/FileUploadOutlined";
import MoreHoriz from "@mui/icons-material/MoreHoriz";
import NewspaperOutlined from "@mui/icons-material/NewspaperOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import ShowChartOutlined from "@mui/icons-material/ShowChartOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

export interface NavItem {
  label: string;
  href: string;
  icon: SvgIconComponent;
}

const overview: NavItem = { label: "Übersicht", href: "/", icon: DashboardOutlined };
const depots: NavItem = { label: "Depots", href: "/depots", icon: AccountBalanceWalletOutlined };
const analyses: NavItem = { label: "Analysen", href: "/analyses", icon: DonutSmallOutlined };
const importItem: NavItem = { label: "Import", href: "/import", icon: FileUploadOutlined };
const news: NavItem = { label: "Nachrichten", href: "/news", icon: NewspaperOutlined };
const securities: NavItem = { label: "Wertpapiere", href: "/securities", icon: ShowChartOutlined };
const watchlists: NavItem = { label: "Watchlists", href: "/watchlists", icon: VisibilityOutlined };
const settings: NavItem = { label: "Einstellungen", href: "/settings", icon: SettingsOutlined };
const more: NavItem = { label: "Mehr", href: "/more", icon: MoreHoriz };

/** Permanent drawer (≥ md). */
export const drawerItems: readonly NavItem[] = [overview, depots, analyses, importItem, news, securities, watchlists, settings];

/** Bottom navigation (< md). */
export const bottomItems: readonly NavItem[] = [overview, depots, analyses, news, more];

/** Destinations reachable through "Mehr" on phones. */
export const moreItems: readonly NavItem[] = [importItem, securities, watchlists, settings];

/** True when `pathname` is `href` or one of its sub-routes ("/" matches only itself). */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The bottom-navigation entry for `pathname`; items under "Mehr" select "Mehr". */
export function activeBottomHref(pathname: string): string | false {
  const direct = bottomItems.find((item) => isActive(item.href, pathname));
  if (direct) return direct.href;
  return moreItems.some((item) => isActive(item.href, pathname)) ? more.href : false;
}

/** The open-import count shown on a nav entry: on "Import" (drawer, "Mehr" list) and on "Mehr" (phones). */
export function navBadgeCount(href: string, openImports: number): number {
  return href === importItem.href || href === more.href ? Math.max(0, openImports) : 0;
}

/** Screen-reader text of the open-import count. */
export function openImportsLabel(count: number): string {
  return count === 1 ? "1 offener Import" : `${count} offene Importe`;
}
