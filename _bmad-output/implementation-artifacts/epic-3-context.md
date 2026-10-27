# Epic 3 Context: Market Data — Prices, Logos, News

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the ledger built in Epics 1–2 reflect real market value without manual work: fetch current and daily historical Prices for every held Security (stocks/ETFs via Yahoo, certificates via onvista, crypto via CoinGecko/Binance), refresh them on a schedule and on demand, flag stale Prices, let Tommy enter manual Prices and fix provider mappings when sources fail, show a locally cached logo at every Security mention, and list the last 14 days of news for holdings, with short in-app teasers where a source provides them. This supplies the price data Epic 4's valuation, charts and return metrics depend on, while keeping the app usable for free (manual Prices as fallback) and private (only symbols/ISINs/names leave the server).

## Stories

- Story 3.1: Securities Page and Provider Mapping
- Story 3.2: Prices for Stocks and ETFs
- Story 3.3: Scheduled Refresh and Stale Flags
- Story 3.4: Prices for Certificates and Crypto
- Story 3.5: Manual Prices
- Story 3.6: Security Logos
- Story 3.7: News on Holdings
- Story 3.8: News Teasers

## Requirements & Constraints

- Current Prices for all held Securities fetched at least daily and on demand; UI shows the latest Price date per Security; a Price older than 3 calendar days is flagged stale in every overview.
- Daily historical Prices back to each held Security's first Transaction; dates without a Price carry forward the last known Price (provider, manual or Transaction-derived) for value, charts and returns.
- Manual Price entry/edit/delete for any Security; a manual Price wins over a provider Price for the same date everywhere and is never overwritten by the scheduler; it clears the stale flag only if dated within 3 days.
- News: headlines of the last 14 days for held Securities, overall and filterable per Security, newest first, each linking to the original article (new tab).
- News teasers: where available, show a short plain-text teaser (max ~600 chars, cut at sentence/word boundary) in the app before the user leaves for the article; only items mentioning the Security's name (legal-form suffixes ignored) or symbol are kept; no scraping of article pages and no circumventing consent walls/redirects.
- Privacy: outbound requests carry only provider symbols, ISINs or company names — never quantities, values or Depot data. No third-party calls from the browser (logos served from the app's own route).
- Cost: no paid service required; providers are free/unofficial and may break — fail soft (per-Security error, stale flag, manual Price), never break other fetches or ledger writes. No automatic failover between providers.
- Tests never hit live providers: mapping resolver, every provider adapter and news parsing are unit-tested with recorded responses; a contract test on a Security with a known split proves unadjusted storage.
- CoinGecko attribution ("Data provided by CoinGecko") must be visible on the Securities page.
- API keys only via env: `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`; logo files under `DATA_DIR`. Never commit keys or real data.

## Technical Decisions

- **Module ownership:** `prices` owns ProviderMapping and Price (+ scheduler jobs); `logos` owns SecurityLogo and logo files; `news` owns the news cache. Each reaches `ledger` only via its exported service; only `ledger` writes Security name/`assetType` (type change on Securities page goes through `ledger`). Writing services accept an optional Prisma tx client. Models are created in the story that first needs them (ProviderMapping 3.1, Price 3.2, SecurityLogo 3.6).
- **Provider interface:** every price source implements `fetchLatest` / `fetchHistory` by provider symbol, returning EUR closes per business date. Same provider pattern for news and logo providers. Adapters live in `src/modules/<module>/providers/<name>.ts`.
- **Mapping:** at most one active ProviderMapping (provider + symbol) per Security, auto-resolved once — OpenFIGI by ISIN preferring the Xetra listing (code `GY`), fallback Yahoo `search()`; certificates default to onvista; crypto to CoinGecko by symbol. User-editable.
- **Price storage:** Price rows `source ∈ {manual, provider}`, unique `(securityId, date, source)`, UTC `fetchedAt`, value as TEXT decimal string (decimal.js only; no SQL arithmetic, no JS `number`, no Prisma `Decimal`). Dates `YYYY-MM-DD` Europe/Berlin.
- **Unadjusted storage:** stored Prices are as-traded closes. Yahoo history is split-adjusted, so the adapter undoes adjustment using CorporateActions; recording or changing a split triggers a history refetch for that Security. Split adjustment for display is applied by core on read.
- **Resolver (pure core):** one function decides the Price on a date: manual > provider > Transaction price on that date (derived on read, never stored) > carry forward last known. One core `isStale(latestPriceDate, today)` (> 3 calendar days) is the only staleness rule. Core stays pure: no Prisma/network/clock — pass "today" in.
- **Held set:** core `heldSecurities(ledger)` (open Positions in non-archived Depots) is the only definition of "held" for price fetching, backfill and news. Backfill runs on the scheduler run and after a ledger write introduces a new held Security.
- **Providers by asset:** stocks/ETFs `yahoo-finance2` 4.0.5 (instance API `new YahooFinance()`, `.DE`/`.F` tickers); certificates onvista unofficial JSON by ISIN; crypto CoinGecko Demo (365-day history) plus one-time Binance klines (`<SYMBOL>EUR`, 1d) backfill for older history.
- **Scheduler:** in-process, registered from `instrumentation.ts`, `globalThis` guard against double start, never runs during `next build`; price fetch on start and daily; news refresh rides the daily run. Single Node process.
- **News:** query by company name or ticker, never ISIN; Google News RSS (de + en, `hl=de&gl=DE&ceid=DE:de`) primary, `yahoo-finance2` search news secondary; merge and de-dupe by URL/title; cached; refresh on page open if cache older than a few hours. Not ledger data, not backed up.
- **Teasers (3.8):** additional news provider reads the unofficial Yahoo Finance RSS per Yahoo symbol (`feeds.finance.yahoo.com/rss/2.0/headline?s=<symbol>&region=DE&lang=de-DE`) for stocks and crypto (ETFs get nothing there); item description stored as `teaser` (tags/entities stripped, trimmed). Google News stays headline-only for all Securities. On duplicates (URL or normalized title) the item with a teaser wins. Feed failure/empty/malformed = per-Security provider failure; requests spaced, fetched no more often than the existing news cache rule. Teasers are cached news, purged with the 14-day window, not backed up.
- **Logos:** fetched once in the background when a Security is created or first held: logo.dev (by ISIN/ticker/crypto) primary, Elbstream fallback; certificates use issuer/underlying logo; crypto falls back to CoinGecko image. Stored under `DATA_DIR` with source and `fetchedAt`; manual upload (`source = manual`) always wins and is included in the JSON backup, fetched logos are not. A logo fetch never blocks a ledger write.
- **Errors/validation:** zod at shell boundaries (provider responses, forms); expected failures return typed `{ ok: false, reason }` results. Logs never contain amounts or keys.

## UX & Interaction Patterns

- **"Wertpapiere" page:** list of all Securities with logo, name, ISIN/symbol, asset type and mapping (provider + symbol); edit mapping; change type (STOCK, ETF, FUND, CERTIFICATE, CRYPTO), with an "Typ unbekannt" chip for `UNCLASSIFIED`; manual Price entry and per-Security list of manual Prices; upload/replace logo; "Kurse aktualisieren" button with progress and a result snackbar naming failed Securities.
- **Stale badge:** on every price display, text "Kurs vom dd.mm.yyyy – veraltet", tooltip with source and fetch time; stale state always has text (never color alone). Overview shows a warning Alert "Kurse für N Wertpapiere veraltet" linking to Wertpapiere.
- **Fetch failure:** row-level error naming the provider, with a "Kurs manuell eintragen" action.
- **Logo component:** 32px round, served from local cache; missing logo shows deterministic-color initials immediately, no broken image, no layout shift; used at every Security mention.
- **Nachrichten page:** headlines with logo + Security name, source, date, external link; Security filter; empty state "Keine Nachrichten der letzten 14 Tage."
- **Teaser items (Nachrichten and Security detail):** a small marker flags items with a teaser; such an item expands on tap/click (keyboard-accessible accordion) to show teaser, source, date and a "Zum Artikel" link (new tab); items without a teaser open the article directly as before.
- General: German, short factual microcopy; de-DE number/date formats; no optimistic writes; no hover-only actions; ≥ 44 px touch targets; works at phone width.

## Cross-Story Dependencies

- Builds on Epic 1/2: `ledger` services (Securities, `ensureSecurity`, type change), CorporateActions (splits from 2.1 drive Yahoo un-adjustment and refetch), core held-set and Transaction-price fallback, Security logo placeholder component.
- 3.1 (ProviderMapping, Securities page) precedes 3.2 and 3.4 (adapters use mappings). 3.2 creates the Price model and the provider interface that 3.4 and 3.5 reuse. 3.3 schedules the fetches from 3.2/3.4 and adds stale UI; 3.5's "Kurs manuell eintragen" is the action surfaced by 3.3's failure rows. 3.6 replaces 3.1's logo placeholder; 3.7 uses 3.6's logo component and 3.3's daily scheduler. 3.8 extends 3.7's `news` module, cache and page, uses 3.1's Yahoo mappings, and also touches the Security detail view's news list (Epic 4 detail page, if present).
- Epic 4 (overview, charts, TTWROR/XIRR) consumes the core price resolver, carry-forward and `isStale` from this epic. Epic 6 export/restore must include Prices, ProviderMappings and manual logos but exclude news and fetched logos.
