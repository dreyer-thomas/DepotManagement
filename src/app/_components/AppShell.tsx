"use client";

import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import AppBar from "@mui/material/AppBar";
import BottomNavigation from "@mui/material/BottomNavigation";
import BottomNavigationAction from "@mui/material/BottomNavigationAction";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { spacing } from "@/theme/tokens";
import { logout } from "../_actions/logout";
import { ColorModeToggle } from "./ColorModeToggle";
import { activeBottomHref, bottomItems, drawerItems, isActive } from "./navigation";

const DRAWER_WIDTH = 240;
const BOTTOM_NAV_HEIGHT = 56;

/**
 * Responsive app shell: top AppBar; permanent drawer from md (900px) up,
 * bottom navigation below. Breakpoints switch via CSS so SSR renders without layout shift.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <Typography component="div" variant="h6" sx={{ flexGrow: 1, fontWeight: 600, color: "primary.main" }}>
            DepotManagement
          </Typography>
          <ColorModeToggle />
          <form action={logout} style={{ display: "flex" }}>
            <IconButton type="submit" color="inherit" size="large" aria-label="Abmelden" title="Abmelden">
              <LogoutOutlined />
            </IconButton>
          </form>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", borderRight: 0 },
        }}
      >
        <Toolbar />
        <Box component="nav" aria-label="Hauptnavigation">
          <List sx={{ px: 1 }}>
            {drawerItems.map(({ label, href, icon: Icon }) => {
              const active = isActive(href, pathname);
              return (
                <ListItemButton
                  key={href}
                  component={Link}
                  href={href}
                  selected={active}
                  aria-current={active ? "page" : undefined}
                  sx={{
                    minHeight: 44,
                    borderRadius: 2,
                    mb: 0.5,
                    "&.Mui-selected, &.Mui-selected .MuiListItemIcon-root": { color: "primary.main" },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <Icon />
                  </ListItemIcon>
                  <ListItemText primary={label} />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          pb: {
            xs: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px) + 16px)`,
            md: 3,
          },
        }}
      >
        <Toolbar />
        <Box
          sx={{
            maxWidth: spacing["content-max"],
            mx: "auto",
            px: { xs: spacing["page-gutter-mobile"], md: spacing["page-gutter-desktop"] },
            pt: { xs: spacing["page-gutter-mobile"], md: spacing["page-gutter-desktop"] },
          }}
        >
          {children}
        </Box>
      </Box>

      <Paper
        component="nav"
        aria-label="Hauptnavigation"
        elevation={3}
        sx={{
          display: { xs: "block", md: "none" },
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          pb: "env(safe-area-inset-bottom, 0px)",
          borderRadius: 0,
        }}
      >
        <BottomNavigation showLabels value={activeBottomHref(pathname)} sx={{ height: BOTTOM_NAV_HEIGHT }}>
          {bottomItems.map(({ label, href, icon: Icon }) => (
            <BottomNavigationAction
              key={href}
              label={label}
              value={href}
              icon={<Icon />}
              component={Link}
              href={href}
              aria-current={activeBottomHref(pathname) === href ? "page" : undefined}
              sx={{ minWidth: 44, minHeight: 44 }}
            />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}
