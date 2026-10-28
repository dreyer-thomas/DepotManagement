// The watchlist module owns Watchlist and WatchlistEntry (story 9.1, AD-2). It reaches Securities only
// through `@/modules/ledger` (new ones via `ensureSecurity`) and Prices only through `@/modules/prices`;
// it never stores figures (Price, changes are computed on read by `core/watchlist`). `prices` never
// imports this module: the app layer passes `watchlistPriceTargets` to the price runs.
export { createWatchlist, deleteWatchlist, getWatchlist, listWatchlists, renameWatchlist } from "./watchlists";
export type { DeleteWatchlistResult, WatchlistDb, WatchlistFailureReason, WatchlistResult, WatchlistSummary } from "./watchlists";
export {
  addWatchlistEntry,
  removeWatchlistEntry,
  securityWatchlistEntries,
  updateWatchlistEntry,
  watchedSecurityIds,
  watchlistPriceTargets,
  watchlistView,
} from "./entries";
export type {
  AddWatchlistEntryInput,
  AddWatchlistEntryResult,
  RemoveWatchlistEntryResult,
  SecurityWatchlistEntry,
  UpdateWatchlistEntryInput,
  UpdateWatchlistEntryResult,
  WatchlistEntryFailureReason,
  WatchlistEntryRecord,
  WatchlistEntrySource,
  WatchlistEntryView,
  WatchlistView,
} from "./entries";
