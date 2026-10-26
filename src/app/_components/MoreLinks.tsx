"use client";

import ChevronRight from "@mui/icons-material/ChevronRight";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Link from "next/link";
import { moreItems, navBadgeCount, openImportsLabel } from "./navigation";

/** Links to the destinations that do not fit into the phone bottom navigation; Import shows the open-import count. */
export function MoreLinks({ openImports = 0 }: { openImports?: number }) {
  return (
    <Card component="nav" aria-label="Weitere Bereiche">
      <List disablePadding>
        {moreItems.map(({ label, href, icon: Icon }) => {
          const count = navBadgeCount(href, openImports);
          return (
            <ListItemButton key={href} component={Link} href={href} sx={{ minHeight: 56 }}>
              <ListItemIcon>
                <Icon />
              </ListItemIcon>
              <ListItemText primary={label} />
              {count > 0 ? (
                <Chip label={count} size="small" color="primary" aria-label={openImportsLabel(count)} sx={{ mr: 1 }} />
              ) : null}
              <ChevronRight color="action" aria-hidden />
            </ListItemButton>
          );
        })}
      </List>
    </Card>
  );
}
