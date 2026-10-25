import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import FileUploadOutlined from "@mui/icons-material/FileUploadOutlined";
import MoreHoriz from "@mui/icons-material/MoreHoriz";
import NewspaperOutlined from "@mui/icons-material/NewspaperOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import ShowChartOutlined from "@mui/icons-material/ShowChartOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

export interface NavItem {
  label: string;
  href: string;
  icon: SvgIconComponent;
}

const overview: NavItem = { label: "Übersicht", href: "/", icon: DashboardOutlined };
const depots: NavItem = { label: "Depots", href: "/depots", icon: AccountBalanceWalletOutlined };
const importItem: NavItem = { label: "Import", href: "/import", icon: FileUploadOutlined };
const news: NavItem = { label: "Nachrichten", href: "/news", icon: NewspaperOutlined };
const securities: NavItem = { label: "Wertpapiere", href: "/securities", icon: ShowChartOutlined };
const settings: NavItem = { label: "Einstellungen", href: "/settings", icon: SettingsOutlined };
const more: NavItem = { label: "Mehr", href: "/more", icon: MoreHoriz };

/** Permanent drawer (≥ md). */
export const drawerItems: readonly NavItem[] = [overview, depots, importItem, news, securities, settings];

/** Bottom navigation (< md). */
export const bottomItems: readonly NavItem[] = [overview, depots, news, more];

/** Destinations reachable through "Mehr" on phones. */
export const moreItems: readonly NavItem[] = [importItem, securities, settings];

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
