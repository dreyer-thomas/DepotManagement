import { cashEffect } from "@/core/cash";
import { ExactDecimal } from "@/core/decimal";
import { parseDecimalInput } from "@/core/decimal-input";
import { formatMoney } from "@/core/format";
import type { TransactionType } from "@/modules/ledger";

/** Raw (German) text of the form's figure fields. */
export type CashPreviewInputs = { quantity: string; price: string; fee: string; tax: string; amount: string };

export const NO_PREVIEW = "–";

/** Parses one field: `null` when unparseable, or when empty and `required`; empty optional gives "0". */
function value(text: string, required: boolean): string | null {
  const parsed = parseDecimalInput(text);
  if (!parsed.ok) return null;
  if (parsed.value === "") return required ? null : "0";
  return parsed.value;
}

/** The AD-14 figures the form would book for `type`, or `null` while required inputs are missing. */
function figures(type: TransactionType, inputs: CashPreviewInputs): { amount: string; fee: string; tax: string } | null {
  switch (type) {
    case "BUY":
    case "SELL": {
      const quantity = value(inputs.quantity, true);
      const price = value(inputs.price, true);
      const fee = value(inputs.fee, false);
      const tax = value(inputs.tax, false);
      if (quantity === null || price === null || fee === null || tax === null) return null;
      return { amount: new ExactDecimal(quantity).times(price).toFixed(), fee, tax };
    }
    case "DIVIDEND": {
      const amount = value(inputs.amount, true);
      const tax = value(inputs.tax, false);
      return amount === null || tax === null ? null : { amount, fee: "0", tax };
    }
    case "FEE": {
      const fee = value(inputs.amount, true);
      return fee === null ? null : { amount: "0", fee, tax: "0" };
    }
    case "TAX": {
      const tax = value(inputs.amount, true);
      return tax === null ? null : { amount: "0", fee: "0", tax };
    }
    case "DEPOSIT":
    case "WITHDRAWAL": {
      const amount = value(inputs.amount, true);
      return amount === null ? null : { amount, fee: "0", tax: "0" };
    }
  }
}

/** Live cash effect of the form's inputs as signed money (`+50,00 €`), or "–" while incomplete. */
export function cashPreview(type: TransactionType, inputs: CashPreviewInputs): string {
  const row = figures(type, inputs);
  return row ? formatMoney(cashEffect({ type, ...row }), { sign: true }) : NO_PREVIEW;
}
