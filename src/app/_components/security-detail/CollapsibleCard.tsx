"use client";

import ExpandMore from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import { type ReactNode, useState } from "react";
import { CardHeading } from "@/app/_components/overview/CardHeading";

/**
 * A detail-page card that opens and closes with a chevron next to its heading: closed (the default) it
 * shows `collapsed`, open it shows `expanded`. `children` render below in both states. Not remembered.
 */
export function CollapsibleCard({
  id,
  heading,
  collapsed,
  expanded,
  children,
}: {
  /** Id of the heading; the content gets `${id}-content`. */
  id: string;
  heading: string;
  collapsed: ReactNode;
  expanded: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card component="section" aria-labelledby={id} sx={{ mb: 2, minWidth: 0 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mt: -1, mb: -0.5 }}>
          <CardHeading id={id}>{heading}</CardHeading>
          <IconButton
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={`${id}-content`}
            aria-label={open ? `${heading} einklappen` : `${heading} ausklappen`}
            title={open ? "Weniger anzeigen" : "Alle anzeigen"}
            sx={{ width: 44, height: 44, mr: -1.5 }}
          >
            <ExpandMore sx={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }} />
          </IconButton>
        </Box>
        <div id={`${id}-content`}>{open ? expanded : collapsed}</div>
        {children}
      </CardContent>
    </Card>
  );
}
