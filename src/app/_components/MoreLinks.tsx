"use client";

import ChevronRight from "@mui/icons-material/ChevronRight";
import Card from "@mui/material/Card";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Link from "next/link";
import { moreItems } from "./navigation";

/** Links to the destinations that do not fit into the phone bottom navigation. */
export function MoreLinks() {
  return (
    <Card component="nav" aria-label="Weitere Bereiche">
      <List disablePadding>
        {moreItems.map(({ label, href, icon: Icon }) => (
          <ListItemButton key={href} component={Link} href={href} sx={{ minHeight: 56 }}>
            <ListItemIcon>
              <Icon />
            </ListItemIcon>
            <ListItemText primary={label} />
            <ChevronRight color="action" aria-hidden />
          </ListItemButton>
        ))}
      </List>
    </Card>
  );
}
