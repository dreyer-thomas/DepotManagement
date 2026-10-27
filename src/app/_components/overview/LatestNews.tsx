import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { NewsListArticle } from "@/modules/news";
import { AppLink } from "../depots/DepotLink";
import { articleMeta, NEW_TAB_HINT, NEWS_EMPTY_TEXT, visuallyHidden } from "../news/labels";
import { SecurityLogo } from "../securities/SecurityLogo";
import { CardHeading } from "./CardHeading";

/** Number of headlines on the Overview. */
export const LATEST_NEWS = 3;

/**
 * "Nachrichten": the given cached headlines (newest first) with logo, headline as external link (new
 * tab) and "<source> · dd.mm.yyyy", plus a link to all news. No provider call.
 */
export function LatestNews({ articles }: { articles: readonly NewsListArticle[] }) {
  return (
    <Card component="section" aria-labelledby="overview-news" sx={{ minWidth: 0 }}>
      <CardContent>
        <CardHeading id="overview-news">Nachrichten</CardHeading>
        {articles.length === 0 ? (
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {NEWS_EMPTY_TEXT}
          </Typography>
        ) : (
          <Box component="ul" aria-label="Neueste Nachrichten" sx={{ listStyle: "none", m: 0, p: 0, mb: 1 }}>
            {articles.map((article) => (
              <Box component="li" key={article.id} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", mb: 1.5 }}>
                <SecurityLogo securityId={article.securityId} name={article.name} />
                <Box sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
                  <Link
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    color="inherit"
                    variant="body2"
                    sx={{ fontWeight: 500, display: "inline-block", minHeight: 24 }}
                  >
                    {article.title}
                    <Box component="span" sx={visuallyHidden}>
                      {NEW_TAB_HINT}
                    </Box>
                  </Link>
                  <Typography variant="caption" color="text.secondary" component="p">
                    {articleMeta(article.source, article.publishedAt)}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        <AppLink href="/news">Alle Nachrichten</AppLink>
      </CardContent>
    </Card>
  );
}
