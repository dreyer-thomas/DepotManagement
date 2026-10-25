# Glossary — DepotManagement

Domain terms are code names (spine Consistency Conventions).

- **Depot** — One securities account at one Broker; holds zero or more Positions; owns exactly one Cash Account.
- **Broker** — Institution holding a Depot. v1: comdirect/cominvest, Deutsche Bank/ROBIN, finanzen.net zero/Baader Bank.
- **Portfolio** — Combined view of all non-archived Depots.
- **Security** — Tradable instrument identified by ISIN (or symbol for crypto). Asset types: stock, ETF, certificate (e.g. open-end turbo), crypto. Stocks and ETFs dominate.
- **Cash Account** — Settlement account (Verrechnungskonto) of exactly one Depot; EUR balance changed by Deposits, Withdrawals and the cash side of Transactions.
- **Position** — Holding of one Security in one Depot: quantity, Cost Basis, current value.
- **Transaction** — Booked event changing a Position or Cash Account: buy, sell, dividend/distribution, fee, tax, Deposit, Withdrawal. Corporate actions are separate events (spine AD-7).
- **Deposit / Withdrawal** — Money moved into or out of a Cash Account from outside the Depot.
- **Document Import** — Creating Transactions from uploaded broker PDF documents (trade and dividend confirmations). Distinct from the one-time Parqet CSV migration.
- **Price** — A Security's quoted value on a date, from a Price Source, manual entry, or a Transaction.
- **Price Source** — External provider of current and historical Prices.
- **Cost Basis** — Purchase cost (price × quantity + fees) of units still held, by FIFO (earliest bought units sold first), as German tax law and Parqet.
- **Invested capital** — Cost Basis of open Positions.
- **Gain/Loss** — Value change from price movement and income (dividends) minus fees, against Cost Basis; realized (sales) or unrealized (open Positions). Shown gross; taxes paid shown separately.
- **Period** — Selectable time range for charts and evaluations (1M, YTD, 1Y, Max, custom).
