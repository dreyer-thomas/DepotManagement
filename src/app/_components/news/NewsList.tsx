import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";
import type { NewsListArticle } from "@/modules/news";
import { SecurityLogo } from "../securities/SecurityLogo";
import { articleMeta, NEW_TAB_HINT, NEWS_EMPTY_TEXT } from "./labels";

/** Hidden visually, read by screen readers (same rules as MUI's `visuallyHidden`). */
const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

/**
 * Headlines, newest first. Each row is one external link (new tab) to the original article with the
 * Security logo and name, the headline and "<source> · dd.mm.yyyy"; the empty state names the window.
 */
export function NewsList({ articles }: { articles: readonly NewsListArticle[] }) {
  if (articles.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography>{NEWS_EMPTY_TEXT}</Typography>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <List disablePadding aria-label="Nachrichten">
        {articles.map((article, index) => (
          <Fragment key={article.id}>
            {index > 0 && <Divider component="li" aria-hidden />}
            <li>
              <ListItemButton
                component="a"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ minHeight: 44, gap: 2, alignItems: "flex-start", py: 1.5 }}
              >
                <SecurityLogo securityId={article.securityId} name={article.name} />
                <Box sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
                  <Typography variant="body2" color="text.secondary">
                    {article.name}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {article.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {articleMeta(article.source, article.publishedAt)}
                  </Typography>
                </Box>
                <Box component="span" sx={visuallyHidden}>
                  {NEW_TAB_HINT}
                </Box>
                <OpenInNewIcon fontSize="small" color="action" aria-hidden sx={{ mt: 0.5, flexShrink: 0 }} />
              </ListItemButton>
            </li>
          </Fragment>
        ))}
      </List>
    </Card>
  );
}
