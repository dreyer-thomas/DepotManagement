// The parser registry contract (AD-4): a broker parser is a pure function from the extracted document
// text to Transaction proposals in AD-14 shape, or a ParseError. Proposals carry the ISIN, never a
// securityId: Securities are created only when a proposal is booked (AD-16).
import Decimal from "decimal.js";
import { z } from "zod";
import { isBusinessDate } from "@/core/dates";
import { canonicalDecimal, isDecimalString } from "@/core/decimal";
import { isinSchema, QUANTITY_MAX_DECIMALS, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";

/** Transaction types a document can propose. */
export const PROPOSAL_TYPES = ["BUY", "SELL", "DIVIDEND", "FEE", "TAX"] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/** A plain decimal string (no exponent, no grouping), returned in canonical form. */
const decimalString = z
  .string()
  .trim()
  .refine(isDecimalString, { error: "decimal-invalid" })
  .transform((value) => canonicalDecimal(value));

/**
 * One proposed Transaction (AD-14): unsigned gross `amount`, `fee ≥ 0`, signed `tax`; the per-type rules
 * match the ledger's validation, so a PARSED proposal is bookable. `isin` is optional only on FEE and TAX.
 */
export const transactionProposalSchema = z
  .object({
    type: z.enum(PROPOSAL_TYPES),
    date: z.string().refine(isBusinessDate, { error: "date-invalid" }),
    isin: isinSchema.optional(),
    name: z.string().normalize("NFC").trim().min(1).max(SECURITY_NAME_MAX_LENGTH).optional(),
    quantity: decimalString.optional(),
    price: decimalString.optional(),
    amount: decimalString,
    fee: decimalString.default("0"),
    tax: decimalString.default("0"),
  })
  .strict()
  .superRefine((proposal, context) => {
    // Runs even when a field failed above; such fields are skipped here (their issue is already recorded).
    const dec = (value: unknown) => (isDecimalString(value) ? new Decimal(value) : null);
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    const trade = proposal.type === "BUY" || proposal.type === "SELL";
    if (trade) {
      if (proposal.quantity === undefined) issue("quantity", "quantity-missing");
      else {
        const quantity = dec(proposal.quantity);
        if (quantity && (!quantity.greaterThan(0) || quantity.decimalPlaces() > QUANTITY_MAX_DECIMALS)) issue("quantity", "quantity-invalid");
      }
      if (proposal.price === undefined) issue("price", "price-missing");
      else if (dec(proposal.price)?.isNegative()) issue("price", "price-invalid");
    } else {
      if (proposal.quantity !== undefined) issue("quantity", "quantity-not-allowed");
      if (proposal.price !== undefined) issue("price", "price-not-allowed");
    }
    if (proposal.isin === undefined && (trade || proposal.type === "DIVIDEND")) issue("isin", "isin-missing");
    const amount = dec(proposal.amount);
    const fee = dec(proposal.fee);
    const tax = dec(proposal.tax);
    if (amount?.isNegative()) issue("amount", "amount-invalid");
    if (fee?.isNegative()) issue("fee", "fee-invalid");
    if (proposal.type === "DIVIDEND" && amount && !amount.greaterThan(0)) issue("amount", "amount-invalid");
    if (proposal.type === "FEE") {
      if (fee && !fee.greaterThan(0)) issue("fee", "fee-invalid");
      if (amount && !amount.isZero()) issue("amount", "amount-not-allowed");
      if (tax && !tax.isZero()) issue("tax", "tax-not-allowed");
    }
    if (proposal.type === "TAX") {
      if (tax?.isZero()) issue("tax", "tax-invalid");
      if (amount && !amount.isZero()) issue("amount", "amount-not-allowed");
      if (fee && !fee.isZero()) issue("fee", "fee-not-allowed");
    }
  });

/** A validated proposal: decimals are canonical strings; `fee` and `tax` default to `"0"`. */
export type TransactionProposal = z.output<typeof transactionProposalSchema>;

/** What a parser returns per proposal (validated and normalised by the registry). */
export type TransactionProposalInput = z.input<typeof transactionProposalSchema>;

/** A list of valid proposals: the shape of every parser result and of every stored item. */
export const proposalListSchema = z.array(transactionProposalSchema);

/**
 * Why a parser produced no proposals: `unrecognized` lets the next parser try; `invalid` means the
 * parser recognised its layout but could not read it (`message` is a German reason).
 */
export type ParseError = { error: "unrecognized" } | { error: "invalid"; message: string };

/**
 * Cross-file data of a document, merged by `linkDocuments` within one upload and never stored (story 5.4):
 * a comdirect Ertragsgutschrift (`dividend-credit`) and its separate Steuermitteilung
 * (`dividend-tax-notice`) share a reference number. Amounts are decimal strings, signed as printed.
 */
export type DocumentLink =
  | { kind: "dividend-credit"; reference: string; beforeTax: string }
  | { kind: "dividend-tax-notice"; reference: string; isin: string; beforeTax: string; afterTax: string };

/** Validates a parser's link (decimals canonical). */
export const documentLinkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dividend-credit"), reference: z.string().trim().min(1), beforeTax: decimalString }).strict(),
  z
    .object({
      kind: z.literal("dividend-tax-notice"),
      reference: z.string().trim().min(1),
      isin: isinSchema,
      beforeTax: decimalString,
      afterTax: decimalString,
    })
    .strict(),
]);

/**
 * A parser result with extras: `note` is a German review hint shown under the file name; `link` feeds
 * `linkDocuments`. Empty `proposals` are valid only with a `dividend-tax-notice` link.
 */
export type ParsedDocument = { proposals: readonly TransactionProposalInput[]; note?: string; link?: DocumentLink };

/** Validates a `ParsedDocument` (proposals as `proposalListSchema`). */
export const parsedDocumentSchema = z
  .object({
    proposals: proposalListSchema,
    note: z.string().trim().min(1).optional(),
    link: documentLinkSchema.optional(),
  })
  .strict();

/** A broker parser: pure, synchronous, no I/O. */
export type Parser = (text: string) => readonly TransactionProposalInput[] | ParsedDocument | ParseError;
