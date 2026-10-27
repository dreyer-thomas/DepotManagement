"use client";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ShortTextIcon from "@mui/icons-material/ShortText";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import ListItemButton from "@mui/material/ListItemButton";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import type { NewsListArticle } from "@/modules/news";
import { SecurityLogo } from "../securities/SecurityLogo";
import { articleMeta, NEW_TAB_HINT, READ_ARTICLE_LABEL, TEASER_MARKER, visuallyHidden } from "./labels";

/**
 * A news item with a teaser: a native button row (logo, name, headline, "<source> · dd.mm.yyyy" and the
 * "Kurztext" marker) toggling a region with the teaser, the meta line and a "Zum Artikel" link (new tab).
 * Click, Enter and Space toggle it (native button); several items may be open at once.
 */
export function NewsTeaserItem({ article, teaser }: { article: NewsListArticle; teaser: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonId = `${id}-button`;
  const panelId = `${id}-panel`;
  const meta = articleMeta(article.source, article.publishedAt);
  return (
    <li>
      <ListItemButton
        component="button"
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        sx={{ minHeight: 44, gap: 2, alignItems: "flex-start", py: 1.5, width: "100%", textAlign: "left", font: "inherit" }}
      >
        <SecurityLogo securityId={article.securityId} name={article.name} />
        <Box sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
          <Typography variant="body2" color="text.secondary">
            {article.name}
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {article.title}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5 }}>
            <Typography variant="body2" color="text.secondary" component="span">
              {meta}
            </Typography>
            <Typography
              variant="body2"
              color="primary"
              component="span"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontWeight: 500 }}
            >
              <ShortTextIcon fontSize="small" aria-hidden />
              {TEASER_MARKER}
            </Typography>
          </Box>
        </Box>
        <ExpandMoreIcon
          fontSize="small"
          color="action"
          aria-hidden
          sx={{ mt: 0.5, flexShrink: 0, transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }}
        />
      </ListItemButton>
      <Box id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} sx={{ px: 2, pb: 2, pl: { xs: 2, sm: 8 } }}>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere", mb: 1 }}>
          {teaser}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {meta}
        </Typography>
        <Link
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, minHeight: 44 }}
        >
          {READ_ARTICLE_LABEL}
          <Box component="span" sx={visuallyHidden}>
            {NEW_TAB_HINT}
          </Box>
          <OpenInNewIcon fontSize="small" aria-hidden />
        </Link>
      </Box>
    </li>
  );
}
