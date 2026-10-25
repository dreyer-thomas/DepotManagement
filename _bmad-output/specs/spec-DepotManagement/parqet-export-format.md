# Parqet CSV export format (observed 2026-10-25)

Observed from a real export of one Parqet portfolio (finanzen.net zero, multi-year). The file is personal data and is never stored in the repository. Mapping rules into the ledger: spine AD-6, AD-7, AD-8, AD-14, AD-15, AD-16.

## File
- One file per Parqet portfolio; name `<Portfolio Name>-<YYYYMMDD-HHMMSS>.csv`. The `broker` column is mostly empty → target Depot is chosen at import.
- Semicolon-delimited, text fields quoted, German decimal comma (`1234,56`), numbers unquoted. Newest rows first.
- Export only available on paid Parqet tiers (Plus/Investor): Activities overview → "Export as CSV". **Take it before cancelling the subscription.**

## Columns
`datetime` (ISO UTC), `date` (dd.mm.yyyy), `time`, `price`, `shares`, `amount`, `tax`, `fee`, `realizedgains`, `type`, `broker`, `assettype`, `identifier` (ISIN, or `BTC`), `wkn`, `originalcurrency`, `currency`, `fxrate`, `holding` (Cash Account id), `holdingname`, `holdingnickname`, `exchange`, `avgholdingperiod`, `notes`.

## Values seen
- `type`: `Buy`, `Sell`, `Dividend`, `TransferIn`, `TransferOut`, `cost`.
- `assettype`: `Security` (stocks, ETFs, turbo certificates — not distinguishable), `Cash` (the Depot's Cash Account), `Crypto` (BTC, 8-decimal quantities).

## Structure
- Every Buy/Sell/Dividend is paired with a Cash `TransferOut`/`TransferIn` on the cash holding. Deposits appear as unpaired Cash `TransferIn`.
- ISIN change: same-timestamp pair — Security `TransferOut` of old ISIN (price 0, negative realized gain = Cost Basis) and Security `TransferIn` of new ISIN at carried-over Cost Basis. No split rows in this sample.

## Quirks
- Fractional quantities also outside robo-advisor Depots (e.g. `12,00345678`).
- Negative `tax` on sells/dividends = tax refund.
- `cost` row with amount 0 and only `tax` set = standalone tax debit.
- Dividends sometimes `shares=1, price=amount` — use `amount`, not `price × shares`.
- Rounding mismatch between a trade and its cash pair (e.g. `123,456` vs `123,46`).
- Cash rows may omit the fee, omit withheld tax, differ on dividends, or be one net row for several trades at one instant (e.g. a rebalancing, possibly with a savings contribution invested directly). A difference above €0.01 on the inflow side (cash rows show less going out / more coming in than the trades) is booked as a DEPOSIT before the trades; on the outflow side as a standalone TAX with positive tax after them (story 2.8; story 2.7 booked both as TAX).
- Cash rows may lack deposits, so Parqet's own cash balance can go negative — minimal funding DEPOSITs are added for every export, with or without Cash rows (story 2.8).
- Sell quantities of fractional shares may be rounded, so a sell exceeds the holding by ≤ 0.001 — clamped to the held quantity, the shortfall taken from the next BUY of that Security (story 2.7).
- Date-only events carry synthetic time (06:00Z / 00:00Z).
- `realizedgains` is Parqet's FIFO result — reconciliation check after migration. It excludes fees: a difference equal to the sale's attributable fees (sell fee + consumed share of buy fees) is labelled "Gebühren", not a deviation (story 2.8).
