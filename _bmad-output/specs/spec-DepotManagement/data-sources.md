# Price and news sources (researched 2026-10-25)

Provider rules: spine AD-9 (prices), AD-11 (news), AD-19 (logos), AD-13 (only symbols/names leave the server). All free sources are unofficial and can break; "forum" = community-sourced only.

| Need | Primary | Fallback |
| --- | --- | --- |
| Stocks, ETFs (German listings) | `yahoo-finance2` 4.0.5 — `.DE` (Xetra) / `.F` tickers, EUR, deep history; Node ≥ 22, instance API `new YahooFinance()`; history is split-adjusted | onvista unofficial JSON (`api.onvista.de/api/v1/instruments/.../eod_history`), by ISIN, forum |
| ISIN → ticker | OpenFIGI (free; 25 req/min without key, more with free key; Xetra code `GY`) | Yahoo `search()` by ISIN |
| Certificates (turbos) | onvista unofficial JSON | ls-tc.de JSON (needs internal id) or manual Price |
| Crypto (EUR) | CoinGecko Demo (free key, 10k calls/month, attribution, 365-day history) | Binance public klines `BTCEUR` 1d for one-time backfill (no key) |
| News | Google News RSS search by company name, `hl=de&gl=DE&ceid=DE:de` and English; no key; terms unverified | `yahoo-finance2` search news (by name/ticker — ISIN query returns no news); Marketaux free key (100 req/day, 3 articles) |
| Logos | logo.dev Community (free key; storing via secret-key API allowed; `/isin/`, `/ticker/`, `/crypto/`; PNG only; German coverage unverified) | Elbstream `api.elbstream.com/logos/isin|symbol|crypto/…` (no key, SVG; free tier needs visible attribution, terms target business customers, storing is a paid feature — use sparingly); certificates → issuer/underlying logo; crypto → CoinGecko `image`; else initials |

**Paid escape hatch:** EODHD All-World ~€19.99/month (Xetra coverage tier unclear — verify with free key first).

**Rejected:** Stooq (CAPTCHA key, low quota), Alpha Vantage (25/day), Twelve Data / FMP / Marketstack free tiers (no usable German coverage or history), boerse-frankfurt/JustETF scraping (fragile), Brandfetch logos (no caching, hotlink-only), Finnhub news (North America only), NewsAPI.org (free tier forbids production), GNews (12 h delay).
