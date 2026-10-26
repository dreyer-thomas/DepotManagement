// comdirect / cominvest securities settlement ("GESCHÄFTSABRECHNUNG" with "Wertpapierkauf" /
// "Wertpapierverkauf"). The settlement page prints only the amount "vor Steuern"; the tax comes from the
// Steuermitteilung page of the same file ("Steuerliche Behandlung: … Nr. <Geschäftsnummer>"). One proposal
// per settlement, so savings-plan and multi-execution documents yield one proposal per execution.
import type Decimal from "decimal.js";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { isinSchema, QUANTITY_MAX_DECIMALS, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import type { ParsedDocument, Parser, TransactionProposalInput } from "../../proposal";
import { AMOUNT_PATTERN, DATE_PATTERN, germanAmount, germanDate, ISIN_PATTERN } from "../german";
import {
  foreignCurrencyReason,
  implausibleReason,
  missingFieldReason,
  STORNO_REASON,
  TRADE_WITHOUT_NOTICE_NOTE,
  tradeNoticeMismatchReason,
  UNMATCHED_TRADE_NOTICE_REASON,
} from "./reasons";
import { NOTICE_MARKER, readTaxNotice, type TaxNotice } from "./tax-notice";

const SETTLEMENT_MARKER = /GESCHÄFTSABRECHNUNG/g;
const TRADE_KIND = /\bWertpapier(kauf|verkauf)\b/;
const STORNO = /Storno/i;

const BUSINESS_NUMBER = /Geschäftsnummer\s*:\s*(\d[\d ]*\d|\d)/;
const TRADE_DATE = new RegExp(String.raw`Geschäftstag\s*:\s*(${DATE_PATTERN})`);
// "Wertpapier-Bezeichnung WPKNR/ISIN", then "<name> <WKN>" and "<name continued> <ISIN>".
const SECURITY = new RegExp(String.raw`WPKNR\/ISIN[ \t]*\n[ \t]*([^\n]*\S)[ \t]*\n[^\n]*?\b(${ISIN_PATTERN})[ \t]*$`, "m");
const NAME_WITH_WKN = /^(.*\S)\s+[A-Z0-9]{6}$/;
const QUANTITY_PRICE = new RegExp(String.raw`^[ \t]*St\.[ \t]+(${AMOUNT_PATTERN})[ \t]+([A-Z]{3})[ \t]+(${AMOUNT_PATTERN})`, "m");
const MARKET_VALUE = new RegExp(String.raw`Kurswert\s*:\s*([A-Z]{3})\s+(${AMOUNT_PATTERN})`);
// "IBAN Valuta Zu Ihren Lasten vor Steuern", then "<IBAN> EUR <Valuta> EUR <total>".
const TOTAL_HEADER = /Zu Ihren (Lasten|Gunsten) vor Steuern[ \t]*\n([^\n]*)/;
const CURRENCY_AMOUNT = new RegExp(String.raw`\b([A-Z]{3})[ \t]+(${AMOUNT_PATTERN})`, "g");

/** Tolerance between Kurswert and quantity × price (prices may be printed rounded). */
const MIN_TOLERANCE = new ExactDecimal("0.05");
const RELATIVE_TOLERANCE = new ExactDecimal("0.005");

type Read<T> = { ok: true; value: T } | { ok: false; message: string };

type Settlement = { proposal: TransactionProposalInput; number: string | null; total: Decimal };

function eur(currency: string, raw: string, field: string, where: string): Read<string> {
  if (currency !== "EUR") return { ok: false, message: foreignCurrencyReason("Abrechnung", currency, where) };
  const value = germanAmount(raw);
  return value === null ? { ok: false, message: missingFieldReason(field, where) } : { ok: true, value };
}

function readSettlement(part: string, where: string): Read<Settlement> {
  const kind = TRADE_KIND.exec(part);
  if (!kind) return { ok: false, message: missingFieldReason("Geschäftsart", where) };
  const type = kind[1] === "kauf" ? "BUY" : "SELL";

  const dateMatch = TRADE_DATE.exec(part);
  const date = dateMatch ? germanDate(dateMatch[1]) : null;
  if (date === null) return { ok: false, message: missingFieldReason("Geschäftstag", where) };

  const security = SECURITY.exec(part);
  const isin = security ? isinSchema.safeParse(security[2]) : null;
  if (!isin?.success) return { ok: false, message: missingFieldReason("ISIN", where) };

  const quantityPrice = QUANTITY_PRICE.exec(part);
  const quantity = quantityPrice ? germanAmount(quantityPrice[1]) : null;
  if (!quantityPrice || quantity === null) return { ok: false, message: missingFieldReason("Stückzahl", where) };
  const price = eur(quantityPrice[2], quantityPrice[3], "Kurs", where);
  if (!price.ok) return price;

  const marketMatch = MARKET_VALUE.exec(part);
  if (!marketMatch) return { ok: false, message: missingFieldReason("Kurswert", where) };
  const marketValue = eur(marketMatch[1], marketMatch[2], "Kurswert", where);
  if (!marketValue.ok) return marketValue;

  const totalMatch = TOTAL_HEADER.exec(part);
  const totalPair = totalMatch ? [...totalMatch[2].matchAll(CURRENCY_AMOUNT)].at(-1) : undefined;
  if (!totalMatch || !totalPair) return { ok: false, message: missingFieldReason("Betrag vor Steuern", where) };
  if ((type === "BUY") !== (totalMatch[1] === "Lasten")) {
    return { ok: false, message: implausibleReason("Buchungsrichtung passt nicht zur Geschäftsart", where) };
  }
  const totalValue = eur(totalPair[1], totalPair[2], "Betrag vor Steuern", where);
  if (!totalValue.ok) return totalValue;

  const qty = new ExactDecimal(quantity);
  const unitPrice = new ExactDecimal(price.value);
  const amount = new ExactDecimal(marketValue.value);
  const total = new ExactDecimal(totalValue.value).abs();
  if (!qty.greaterThan(0) || qty.decimalPlaces() > QUANTITY_MAX_DECIMALS) {
    return { ok: false, message: missingFieldReason("Stückzahl", where) };
  }
  if (!unitPrice.greaterThan(0) || !amount.greaterThan(0) || !total.greaterThan(0)) {
    return { ok: false, message: implausibleReason("Kurs, Kurswert oder Betrag vor Steuern nicht plausibel", where) };
  }
  if (qty.times(unitPrice).minus(amount).abs().greaterThan(ExactDecimal.max(MIN_TOLERANCE, amount.times(RELATIVE_TOLERANCE)))) {
    return { ok: false, message: implausibleReason("Kurswert passt nicht zu Stückzahl und Kurs", where) };
  }
  const fee = type === "BUY" ? total.minus(amount) : amount.minus(total);
  if (fee.isNegative()) return { ok: false, message: implausibleReason("Gebühren der Abrechnung nicht plausibel", where) };

  // The name is only a suggestion (AD-16): an over-long line is dropped rather than failing the document.
  const nameLine = security?.[1].trim() ?? "";
  const name = (NAME_WITH_WKN.exec(nameLine)?.[1] ?? nameLine).trim();
  const numberMatch = BUSINESS_NUMBER.exec(part);
  return {
    ok: true,
    value: {
      number: numberMatch ? numberMatch[1].replace(/\D/g, "") : null,
      total,
      proposal: {
        type,
        date,
        isin: isin.data,
        ...(name && name.length <= SECURITY_NAME_MAX_LENGTH ? { name } : {}),
        quantity: canonicalDecimal(qty),
        price: canonicalDecimal(unitPrice),
        amount: canonicalDecimal(amount),
        fee: canonicalDecimal(fee),
        tax: "0",
      },
    },
  };
}

/** The notice's ISIN and |vor Steuern| must equal the settlement's; tax = −abgeführte Steuern. */
function applyNotice(settlement: Settlement, notice: TaxNotice, where: string): Read<TransactionProposalInput> {
  if (notice.isin !== settlement.proposal.isin || !new ExactDecimal(notice.beforeTax).abs().equals(settlement.total)) {
    return { ok: false, message: tradeNoticeMismatchReason(where) };
  }
  return { ok: true, value: { ...settlement.proposal, tax: canonicalDecimal(new ExactDecimal(0).minus(notice.withheld)) } };
}

/** Parses a comdirect settlement document; all settlements (with their notices) or nothing. */
export const parseComdirectTrade: Parser = (text) => {
  const settlementMarkers = [...text.matchAll(SETTLEMENT_MARKER)];
  if (settlementMarkers.length === 0 || !TRADE_KIND.test(text)) return { error: "unrecognized" };
  if (STORNO.test(text)) return { error: "invalid", message: STORNO_REASON };

  // Each part runs from its marker to the next marker of either kind.
  const markers = [
    ...settlementMarkers.map((match) => ({ index: match.index, kind: "settlement" as const })),
    ...[...text.matchAll(new RegExp(NOTICE_MARKER.source, "g"))].map((match) => ({ index: match.index, kind: "notice" as const })),
  ].sort((a, b) => a.index - b.index);
  const parts = markers.map((marker, index) => ({
    kind: marker.kind,
    text: text.slice(marker.index, index + 1 < markers.length ? markers[index + 1].index : text.length),
  }));

  const settlementParts = parts.filter((part) => part.kind === "settlement");
  const multiple = settlementParts.length > 1;
  const settlements: Settlement[] = [];
  for (const [index, part] of settlementParts.entries()) {
    const result = readSettlement(part.text, multiple ? ` (Abrechnung ${index + 1})` : "");
    if (!result.ok) return { error: "invalid", message: result.message };
    settlements.push(result.value);
  }

  const notices: TaxNotice[] = [];
  for (const [index, part] of parts.filter((entry) => entry.kind === "notice").entries()) {
    const result = readTaxNotice(part.text, multiple ? ` (Steuermitteilung ${index + 1})` : "");
    if (!result.ok) return { error: "invalid", message: result.message };
    notices.push(result.value);
  }

  // Notice → settlement by Geschäftsnummer; a single notice without number pairs with a single settlement.
  const noticeOf = new Map<number, TaxNotice>();
  for (const notice of notices) {
    const matches = settlements.flatMap((settlement, index) =>
      (notice.number !== null && settlement.number === notice.number) ||
      (notice.number === null && settlements.length === 1 && notices.length === 1)
        ? [index]
        : [],
    );
    if (matches.length !== 1 || noticeOf.has(matches[0])) return { error: "invalid", message: UNMATCHED_TRADE_NOTICE_REASON };
    noticeOf.set(matches[0], notice);
  }

  const proposals: TransactionProposalInput[] = [];
  for (const [index, settlement] of settlements.entries()) {
    const notice = noticeOf.get(index);
    if (!notice) {
      proposals.push(settlement.proposal);
      continue;
    }
    const result = applyNotice(settlement, notice, multiple ? ` (Abrechnung ${index + 1})` : "");
    if (!result.ok) return { error: "invalid", message: result.message };
    proposals.push(result.value);
  }
  const document: ParsedDocument = { proposals };
  if (noticeOf.size < settlements.length) document.note = TRADE_WITHOUT_NOTICE_NOTE;
  return document;
};
