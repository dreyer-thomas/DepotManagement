// German labels of ledger enums. Safe to import from client components (type imports only).
import type { AssetType } from "./securities";

/** German labels of the asset types, in selection order. */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  STOCK: "Aktie",
  ETF: "ETF",
  FUND: "Fonds",
  CERTIFICATE: "Zertifikat",
  CRYPTO: "Krypto",
  UNCLASSIFIED: "Nicht zugeordnet",
};
