// The news module owns NewsArticle and NewsFetch (AD-11). Other code uses only this entry point.
export {
  listNews,
  NEWS_MAX_AGE_HOURS,
  NEWS_PER_SECURITY_LIMIT,
  NEWS_WINDOW_DAYS,
  newsNeedsRefresh,
  refreshNews,
} from "./news";
export type {
  NewsDb,
  NewsDeps,
  NewsListArticle,
  NewsListing,
  NewsProvider,
  NewsRunFailure,
  NewsRunResult,
  RefreshNewsOptions,
} from "./news";
export { newsTerm } from "./terms";
