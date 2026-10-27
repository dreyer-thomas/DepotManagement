/**
 * German capital-gains tax preview per broker and year (AD-21, story 8.3). Pure, decimal strings only;
 * "today" is passed in. An estimate within a limited scope: no church tax, no loss carry-forward, no
 * Vorabpauschale, no foreign-tax credit. Nothing here is booked or stored.
 *
 * The tax unit is the broker: all Depots of one broker (archived included) share one allowance and one
 * set of loss pots. Gains are FIFO realized results per Depot (AD-10, fees inside, tax excluded), taken in
 * the year of the sale date. Withheld tax is the signed `tax` of the broker's rows dated in the year.
 */
import type { CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo } from "./fifo";
import type { GainsRow } from "./gains-analysis";

type Decimal = InstanceType<typeof ExactDecimal>;

/** Kapitalertragsteuer and Solidaritätszuschlag (on the Kapitalertragsteuer). */
export const TAX_RATES = { capitalGains: "0.25", solidarity: "0.055" } as const;

/** Teilfreistellung rates a Security override may take (§ 20 InvStG). */
export const TEILFREISTELLUNG_RATES = ["0", "0.15", "0.3", "0.6", "0.8"] as const;

/** Teilfreistellung of an equity fund (asset class "Aktien") without an override. */
export const EQUITY_FUND_TEILFREISTELLUNG = "0.3";

/** Statutory Sparer-Pauschbetrag for a single person; a higher sum of allowances gets a hint. */
export const ALLOWANCE_LIMIT_SINGLE = "1000";

/** True when the allowances sum to more than 1.000 € (the single-person limit). */
export function allowanceSumExceedsLimit(sum: string): boolean {
  return new ExactDecimal(sum).greaterThan(ALLOWANCE_LIMIT_SINGLE);
}

export type TaxCategory = "stock" | "fund" | "other";

/** How a Security is taxed: its pot and, for a fund, its Teilfreistellung (0 otherwise). */
export type TaxSecurity = { category: TaxCategory; teilfreistellung: string };

/**
 * Tax category of a Security from its type and effective asset class: STOCK → stock pot; ETF/FUND → fund
 * with the `override` if set, else 30 % for asset class "Aktien" and 0 % otherwise; everything else → other.
 */
export function taxSecurity({ type, assetClass }: { type: string; assetClass: string | null }, override: string | null): TaxSecurity {
  if (type === "STOCK") return { category: "stock", teilfreistellung: "0" };
  if (type === "ETF" || type === "FUND") {
    const teilfreistellung = override ?? (assetClass === "Aktien" ? EQUITY_FUND_TEILFREISTELLUNG : "0");
    return { category: "fund", teilfreistellung: canonicalDecimal(teilfreistellung) };
  }
  return { category: "other", teilfreistellung: "0" };
}

/** The figures of one broker (or the Portfolio total) in one year; all decimal strings. */
export type TaxFigures = {
  /** Σ gross DIVIDEND amounts, fund distributions after Teilfreistellung. */
  dividends: string;
  /** Σ positive stock sale gains. */
  stockGains: string;
  /** Σ stock sale losses (positive number). */
  stockLosses: string;
  /** Σ fund sale gains after Teilfreistellung, signed. */
  fund: string;
  /** Σ other sale gains, signed. */
  other: string;
  /** General-pot loss offset against the stock net gain. */
  offsetAgainstStock: string;
  /** Stock loss left after offsetting (only stock gains could absorb it). */
  unusedStockLoss: string;
  /** General-pot loss left after offsetting. */
  unusedOtherLoss: string;
  taxable: string;
  allowance: string;
  allowanceUsed: string;
  allowanceLeft: string;
  /** taxable − allowanceUsed. */
  base: string;
  /** Kapitalertragsteuer 25 %, rounded half-up to cents. */
  capitalGainsTax: string;
  /** Solidaritätszuschlag 5,5 % of the Kapitalertragsteuer, rounded half-up to cents. */
  solidaritySurcharge: string;
  /** capitalGainsTax + solidaritySurcharge. */
  estimated: string;
  /** Σ signed tax of the broker's rows in the year (refunds negative). */
  withheld: string;
  /** withheld − estimated: > 0 expected refund, < 0 expected additional charge. */
  difference: string;
};

export type TaxBrokerResult = TaxFigures & { broker: string };

/** One year: a result per broker, the Portfolio total (field-wise sum) and the sum of the year's allowances. */
export type TaxYear = { year: string; brokers: TaxBrokerResult[]; total: TaxFigures; allowanceSum: string };

export type TaxAllowanceInput = { broker: string; year: number; amount: string };

export type TaxPreviewInput = {
  /** Every Depot (archived included) with its broker and ledger rows; FIFO runs per Depot. */
  depots: readonly { broker: string; rows: readonly GainsRow[] }[];
  actions: CorporateActions;
  /** Security id → tax category; a missing id counts as other. */
  securities: Readonly<Record<string, TaxSecurity>>;
  allowances: readonly TaxAllowanceInput[];
  /** The brokers to report, in display order (those with at least one Depot). */
  brokers: readonly string[];
  today: string;
};

const FIELDS = [
  "dividends",
  "stockGains",
  "stockLosses",
  "fund",
  "other",
  "offsetAgainstStock",
  "unusedStockLoss",
  "unusedOtherLoss",
  "taxable",
  "allowance",
  "allowanceUsed",
  "allowanceLeft",
  "base",
  "capitalGainsTax",
  "solidaritySurcharge",
  "estimated",
  "withheld",
  "difference",
] as const satisfies readonly (keyof TaxFigures)[];

const WITHHELD_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "FEE", "TAX"]);

const OTHER: TaxSecurity = { category: "other", teilfreistellung: "0" };

type Income = { dividends: Decimal; stockGains: Decimal; stockLosses: Decimal; fund: Decimal; other: Decimal; withheld: Decimal };

const emptyIncome = (): Income => ({
  dividends: new ExactDecimal(0),
  stockGains: new ExactDecimal(0),
  stockLosses: new ExactDecimal(0),
  fund: new ExactDecimal(0),
  other: new ExactDecimal(0),
  withheld: new ExactDecimal(0),
});

const round2 = (value: Decimal) => value.toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
const max0 = (value: Decimal) => ExactDecimal.max(value, 0);

/** Loss offsetting, allowance and estimated tax of one broker's income in one year. */
function taxFigures(income: Income, allowanceAmount: string): TaxFigures {
  const general = income.dividends.plus(income.fund).plus(income.other);
  const stockNet = income.stockGains.minus(income.stockLosses);
  const generalLoss = max0(general.negated());
  let offsetAgainstStock = new ExactDecimal(0);
  let unusedStockLoss = new ExactDecimal(0);
  let unusedOtherLoss: Decimal;
  let taxable: Decimal;
  if (stockNet.greaterThanOrEqualTo(0)) {
    offsetAgainstStock = ExactDecimal.min(generalLoss, stockNet);
    taxable = max0(general).plus(stockNet).minus(offsetAgainstStock);
    unusedOtherLoss = generalLoss.minus(offsetAgainstStock);
  } else {
    unusedStockLoss = stockNet.negated();
    taxable = max0(general);
    unusedOtherLoss = generalLoss;
  }
  const allowance = new ExactDecimal(allowanceAmount);
  const allowanceUsed = ExactDecimal.min(allowance, taxable);
  const base = taxable.minus(allowanceUsed);
  const capitalGainsTax = round2(base.times(TAX_RATES.capitalGains));
  const solidaritySurcharge = round2(capitalGainsTax.times(TAX_RATES.solidarity));
  const estimated = capitalGainsTax.plus(solidaritySurcharge);
  const values: Record<keyof TaxFigures, Decimal> = {
    dividends: income.dividends,
    stockGains: income.stockGains,
    stockLosses: income.stockLosses,
    fund: income.fund,
    other: income.other,
    offsetAgainstStock,
    unusedStockLoss,
    unusedOtherLoss,
    taxable,
    allowance,
    allowanceUsed,
    allowanceLeft: allowance.minus(allowanceUsed),
    base,
    capitalGainsTax,
    solidaritySurcharge,
    estimated,
    withheld: income.withheld,
    difference: income.withheld.minus(estimated),
  };
  return Object.fromEntries(FIELDS.map((field) => [field, canonicalDecimal(values[field])])) as TaxFigures;
}

/** Field-wise sum of figures (the Portfolio total row; not recomputed). */
function sumFigures(list: readonly TaxFigures[]): TaxFigures {
  return Object.fromEntries(
    FIELDS.map((field) => [field, canonicalDecimal(list.reduce((sum, figures) => sum.plus(figures[field]), new ExactDecimal(0)))]),
  ) as TaxFigures;
}

/**
 * The tax preview per year (newest first, from the first ledger year to today's year; just today's year
 * without rows) and per broker of `brokers`. Rows dated after `today` are ignored. Dividends and sales are
 * classified by `securities` (a sale by the Security FIFO reports it under, i.e. the new one after an ISIN
 * change). See the story 8.3 rules for offsetting, allowance and rounding.
 */
export function taxPreview(input: TaxPreviewInput): TaxYear[] {
  const { today } = input;
  const todayYear = Number(today.slice(0, 4));
  const security = (id: string | null) => (id !== null ? (input.securities[id] ?? OTHER) : OTHER);
  const incomes = new Map<string, Income>();
  const incomeOf = (broker: string, year: number) => {
    const key = `${broker}|${year}`;
    let income = incomes.get(key);
    if (!income) incomes.set(key, (income = emptyIncome()));
    return income;
  };

  let firstYear = todayYear;
  for (const depot of input.depots) {
    const rows = depot.rows.filter((row) => row.date <= today);
    for (const row of rows) {
      const year = Number(row.date.slice(0, 4));
      if (year < firstYear) firstYear = year;
      const income = incomeOf(depot.broker, year);
      if (WITHHELD_TYPES.has(row.type)) income.withheld = income.withheld.plus(row.tax);
      if (row.type === "DIVIDEND") {
        const { category, teilfreistellung } = security(row.securityId);
        const amount = new ExactDecimal(row.amount);
        income.dividends = income.dividends.plus(category === "fund" ? amount.times(new ExactDecimal(1).minus(teilfreistellung)) : amount);
      }
    }
    for (const result of fifo(rows, today, input.actions)) {
      const { category, teilfreistellung } = security(result.securityId);
      for (const sale of result.sales) {
        const income = incomeOf(depot.broker, Number(sale.date.slice(0, 4)));
        const gain = new ExactDecimal(sale.gain);
        if (category === "stock") {
          if (gain.isPositive()) income.stockGains = income.stockGains.plus(gain);
          else income.stockLosses = income.stockLosses.plus(gain.negated());
        } else if (category === "fund") {
          income.fund = income.fund.plus(gain.times(new ExactDecimal(1).minus(teilfreistellung)));
        } else {
          income.other = income.other.plus(gain);
        }
      }
    }
  }

  const years: TaxYear[] = [];
  for (let year = todayYear; year >= firstYear; year -= 1) {
    const allowanceOf = (broker: string) => input.allowances.find((entry) => entry.broker === broker && entry.year === year)?.amount ?? "0";
    const brokers = input.brokers.map((broker) => ({ broker, ...taxFigures(incomes.get(`${broker}|${year}`) ?? emptyIncome(), allowanceOf(broker)) }));
    const allowanceSum = input.allowances
      .filter((entry) => entry.year === year)
      .reduce((sum, entry) => sum.plus(entry.amount), new ExactDecimal(0));
    years.push({ year: String(year), brokers, total: sumFigures(brokers), allowanceSum: canonicalDecimal(allowanceSum) });
  }
  return years;
}
