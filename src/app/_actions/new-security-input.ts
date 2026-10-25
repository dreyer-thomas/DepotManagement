import type { NewSecurityInput } from "@/modules/ledger";

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i;

/**
 * The forms have one "ISIN oder Krypto-Symbol" field: an ISIN-shaped value, or any value for a
 * non-crypto asset type, is an ISIN; otherwise it is a crypto symbol. The ledger validates both.
 */
export function newSecurityInput(identifier: string, name: string, assetType: string): { new: NewSecurityInput } {
  const trimmed = identifier.trim();
  const isIsin = ISIN_SHAPE.test(trimmed) || (assetType !== "CRYPTO" && assetType !== "");
  return { new: isIsin ? { isin: trimmed, name, assetType } : { cryptoSymbol: trimmed, name, assetType } };
}
