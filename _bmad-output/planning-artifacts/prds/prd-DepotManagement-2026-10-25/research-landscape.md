# Research digest: portfolio tracker landscape (2026-10-25)

Web-research subagent digest; forum-sourced claims flagged as uncertain.

## Parqet (baseline)
- Tiers (https://parqet.com/pricing): Basis free (1 portfolio, 2 integrations); Plus €11.99/mo (5 portfolios/integrations/combined views); Investor €29.99/mo (20 each). Plus raised from €9.99 on 2025-08-01.
- Data in: PDF/CSV import for 50+ brokers, Autosync (Trade Republic, Scalable, ING, comdirect, Consorsbank), manual entry.
- Analytics: basic performance + dividend dashboard free; paid adds benchmark, dividend forecast, ETF X-Ray look-through, tax dashboard (sales, dividends, withholding tax).
- Metrics (forum-sourced, uncertain): IZF/XIRR ignoring cash flows < 3 months; TTWROR recently added.

## Comparables
- Portfolio Performance: open-source desktop; strong PDF importers (break on layout changes); TTWROR + IZF; steep learning curve.
- getquin: social tracker, PSD2 sync; Premium ~€90/yr.
- Finanzfluss Copilot: wealth + budgeting, 350+ banks; Plus €69.99/yr.
- Sharesight: international, multi-currency, not German-tax specific.
- Ghostfolio: AGPLv3 self-hosted (NestJS/Next.js/Postgres/Redis); Yahoo/CoinGecko data; ROAI metric; JSON activities API.

## Building blocks
- Prices: Yahoo Finance (exchange suffixes), Alpha Vantage (keyed, rate-limited), scraping Ariva/boerse-frankfurt/onvista; no free official Xetra API.
- ISIN→ticker: OpenFIGI (free, 25 req/min); one ISIN maps to many listings, exchange must be chosen.
- Broker exports: Trade Republic transaction CSV since 2026-04 (no de-dup across overlapping ranges); Scalable CSV (PRIME only, semicolon); comdirect/ING mostly PDF Abrechnungen.
- German tax: Abgeltungsteuer; Vorabpauschale (base value × 70% Basiszins, debited January); Teilfreistellung 30% equity / 15% mixed; Sparer-Pauschbetrag €1,000/€2,000 split via Freistellungsaufträge per Depot; Verlusttöpfe.

## Reported Parqet gaps
- X-Ray paywalled; no built-in rebalancing; clumsy CSV imports for some brokers; paid tier needed for >1 portfolio; confusing IZF treatment.
