/**
 * Realized gains and cash flow per month and year (FR-22, story 7.4). Pure, decimal strings only;
 * "today" is passed in. Same definitions as the Period figures: realized = FIFO gains of SELLs (trade
 * fees inside, tax excluded, FIFO per Depot, AD-10), dividends = gross DIVIDEND amounts, fees = fees of
 * FEE and DIVIDEND rows, taxes = net taxes of all rows; deposits / withdrawals = DEPOSIT / WITHDRAWAL
 * amounts (migration funding and reconciliation corrections included).
 */
import type { CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { saleKey } from "./fee-attribution";
import { fifo, type FifoRow } from "./fifo";

/** A ledger row as the gains analysis needs it: FIFO's fields plus the signed tax. */
export type GainsRow = FifoRow & { tax: string };

/** One month (`YYYY-MM`) or year (`YYYY`); amounts as decimal strings. */
export type GainsBucket = {
  period: string;
  /** Σ FIFO gains of SELLs dated in the bucket. */
  realized: string;
  /** Σ gross DIVIDEND amounts. */
  dividends: string;
  /** Σ fees of FEE and DIVIDEND rows (positive = paid). */
  fees: string;
  /** Σ signed taxes of all rows (paid minus refunds). */
  taxes: string;
  deposits: string;
  withdrawals: string;
  /** deposits − withdrawals. */
  netCashFlow: string;
};

/** One SELL with its FIFO result; `quantity` as booked on the SELL row. */
export type GainsSale = {
  depotId: string;
  securityId: string;
  date: string;
  sequence: number;
  quantity: string;
  proceeds: string;
  costBasis: string;
  gain: string;
  /** gain / costBasis; `null` when the Cost Basis is 0. */
  gainRatio: string | null;
};

export type GainsAnalysis = { months: GainsBucket[]; years: GainsBucket[]; sales: GainsSale[] };

export type GainsDepotInput = { depotId: string; rows: readonly GainsRow[] };

type Totals = {
  realized: InstanceType<typeof ExactDecimal>;
  dividends: InstanceType<typeof ExactDecimal>;
  fees: InstanceType<typeof ExactDecimal>;
  taxes: InstanceType<typeof ExactDecimal>;
  deposits: InstanceType<typeof ExactDecimal>;
  withdrawals: InstanceType<typeof ExactDecimal>;
};

const zero = (): Totals => ({
  realized: new ExactDecimal(0),
  dividends: new ExactDecimal(0),
  fees: new ExactDecimal(0),
  taxes: new ExactDecimal(0),
  deposits: new ExactDecimal(0),
  withdrawals: new ExactDecimal(0),
});

function bucket(period: string, totals: Totals): GainsBucket {
  return {
    period,
    realized: canonicalDecimal(totals.realized),
    dividends: canonicalDecimal(totals.dividends),
    fees: canonicalDecimal(totals.fees),
    taxes: canonicalDecimal(totals.taxes),
    deposits: canonicalDecimal(totals.deposits),
    withdrawals: canonicalDecimal(totals.withdrawals),
    netCashFlow: canonicalDecimal(totals.deposits.minus(totals.withdrawals)),
  };
}

const monthKey = (year: number, month: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

/** Every `YYYY-MM` from `first` to `last` (inclusive). */
function monthRange(first: string, last: string): string[] {
  const keys: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (let key = monthKey(year, month); key <= last; key = monthKey(year, month)) {
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

const compareSales = (a: GainsSale, b: GainsSale) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.sequence !== b.sequence ? a.sequence - b.sequence : a.depotId < b.depotId ? -1 : a.depotId > b.depotId ? 1 : 0;

/**
 * Buckets the scope's ledger per month and per year and lists every sale with its FIFO gain. `depots`
 * are the Depots in scope with their rows; FIFO runs per Depot (never across Depots) as of `today`
 * with `actions`. Rows dated after `today` are ignored. Months run from the first ledger month to today's
 * month, years from the first ledger year to today's year (zeros where nothing happened), both ascending;
 * a year bucket is the sum of its months. Sales are ordered by date, sequence. Empty without rows.
 */
export function gainsAnalysis(depots: readonly GainsDepotInput[], actions: CorporateActions, today: string): GainsAnalysis {
  const scoped = depots.map((depot) => ({ depotId: depot.depotId, rows: depot.rows.filter((row) => row.date <= today) }));
  const allRows = scoped.flatMap((depot) => depot.rows);
  if (allRows.length === 0) return { months: [], years: [], sales: [] };

  const firstMonth = allRows.reduce((first, row) => (row.date < first ? row.date : first), allRows[0].date).slice(0, 7);
  const months = new Map<string, Totals>(monthRange(firstMonth, today.slice(0, 7)).map((key) => [key, zero()]));
  const totalsOf = (date: string) => months.get(date.slice(0, 7)) as Totals;

  for (const row of allRows) {
    const totals = totalsOf(row.date);
    if (row.type === "DIVIDEND") totals.dividends = totals.dividends.plus(row.amount);
    if (row.type === "FEE" || row.type === "DIVIDEND") totals.fees = totals.fees.plus(row.fee);
    if (row.type === "DEPOSIT") totals.deposits = totals.deposits.plus(row.amount);
    if (row.type === "WITHDRAWAL") totals.withdrawals = totals.withdrawals.plus(row.amount);
    totals.taxes = totals.taxes.plus(row.tax);
  }

  const sales: GainsSale[] = [];
  for (const depot of scoped) {
    const booked = new Map<string, GainsRow>();
    for (const row of depot.rows) if (row.type === "SELL") booked.set(saleKey(row.date, row.sequence), row);
    for (const result of fifo(depot.rows, today, actions)) {
      for (const sale of result.sales) {
        const totals = totalsOf(sale.date);
        totals.realized = totals.realized.plus(sale.gain);
        const costBasis = new ExactDecimal(sale.costBasis);
        const row = booked.get(saleKey(sale.date, sale.sequence));
        sales.push({
          depotId: depot.depotId,
          securityId: result.securityId,
          date: sale.date,
          sequence: sale.sequence,
          quantity: canonicalDecimal(row?.quantity ?? sale.quantity),
          proceeds: sale.proceeds,
          costBasis: sale.costBasis,
          gain: sale.gain,
          gainRatio: costBasis.isZero() ? null : canonicalDecimal(new ExactDecimal(sale.gain).dividedBy(costBasis)),
        });
      }
    }
  }
  sales.sort(compareSales);

  const years = new Map<string, Totals>();
  for (const [key, totals] of months) {
    const year = key.slice(0, 4);
    const sum = years.get(year) ?? zero();
    years.set(year, {
      realized: sum.realized.plus(totals.realized),
      dividends: sum.dividends.plus(totals.dividends),
      fees: sum.fees.plus(totals.fees),
      taxes: sum.taxes.plus(totals.taxes),
      deposits: sum.deposits.plus(totals.deposits),
      withdrawals: sum.withdrawals.plus(totals.withdrawals),
    });
  }

  return {
    months: [...months].map(([key, totals]) => bucket(key, totals)),
    years: [...years].map(([key, totals]) => bucket(key, totals)),
    sales,
  };
}

/**
 * The `n` best (gain > 0, largest first) and `n` worst (gain < 0, most negative first) sales; ties by
 * date, then sequence. A sale with gain 0 is in neither list.
 */
export function bestAndWorstSales(sales: readonly GainsSale[], n = 5): { best: GainsSale[]; worst: GainsSale[] } {
  const by = (direction: 1 | -1) => (a: GainsSale, b: GainsSale) => {
    const difference = new ExactDecimal(a.gain).comparedTo(b.gain) * direction;
    return difference !== 0 ? difference : compareSales(a, b);
  };
  return {
    best: sales.filter((sale) => new ExactDecimal(sale.gain).greaterThan(0)).sort(by(-1)).slice(0, n),
    worst: sales.filter((sale) => new ExactDecimal(sale.gain).lessThan(0)).sort(by(1)).slice(0, n),
  };
}
