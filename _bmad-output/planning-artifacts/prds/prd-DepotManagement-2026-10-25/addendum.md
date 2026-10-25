# Addendum: DepotManagement PRD

Implementation-level detail that informs architecture but does not belong in the PRD body.

## A1. Parqet CSV export format (observed 2026-10-25)

Observed from a real export of one Parqet portfolio (file name pattern `<Portfolio Name>-<YYYYMMDD-HHMMSS>.csv`, multi-year history). The file itself is personal data and is **not** stored in the repository.

- **One file per Parqet portfolio**; file name = portfolio name + timestamp. The `broker` column is mostly empty (only a few rows carry `finanzen_zero`), so the target Depot must be chosen at import, not derived from the file.
- **Format:** semicolon-delimited, all text fields quoted, German decimal comma (`1234,56`), numbers unquoted. Newest rows first.
- **Columns:** `datetime` (ISO UTC), `date` (dd.mm.yyyy), `time`, `price`, `shares`, `amount`, `tax`, `fee`, `realizedgains`, `type`, `broker`, `assettype`, `identifier` (ISIN, or `BTC` for crypto), `wkn`, `originalcurrency`, `currency`, `fxrate`, `holding` (Cash Account id), `holdingname`, `holdingnickname`, `exchange`, `avgholdingperiod`, `notes`.
- **Transaction types seen:** `Buy`, `Sell`, `Dividend`, `TransferIn`, `TransferOut`, `cost`.
- **Asset types seen:** `Security` (stocks, ETFs, open-end turbo certificates), `Cash` (the Depot's Cash Account, "Finanzen Zero Cash"), `Crypto` (BTC with 8-decimal fractional quantities).
- **Cash flows:** every Buy/Sell/Dividend is paired with a Cash `TransferOut`/`TransferIn` on the cash holding; Deposits (e.g. recurring savings transfers) appear as unpaired Cash `TransferIn`.
- **Corporate actions / ISIN changes:** represented as a same-timestamp pair — Security `TransferOut` of the old ISIN (price 0, negative realized gain = Cost Basis) and Security `TransferIn` of the new ISIN at the carried-over Cost Basis (old ISIN → new ISIN, both rows with the same timestamp). No split rows in this sample.
- **Quirks to handle:**
  - Fractional quantities also occur outside robo-advisor Depots (e.g. `12,00345678`).
  - Negative `tax` on sells/dividends = tax refund (loss offset).
  - `cost` row with amount 0 and only `tax` set (standalone tax debit).
  - Dividends sometimes stored as `shares=1, price=amount` instead of per-share values — use `amount`, not `price × shares`.
  - Minor rounding mismatch between a trade and its cash pair (e.g. `123,456` vs `123,46`).
  - Date-only events carry a synthetic time (06:00Z / 00:00Z).
  - `realizedgains` is Parqet's FIFO result — useful as a reconciliation check after migration.
