import { createFilterOptions } from "@mui/material/Autocomplete";
import type { SecuritySummary } from "@/modules/ledger";

/** An Autocomplete option of a Security picker: an existing Security, or "Neue Security anlegen". */
export type SecurityOption = { kind: "security"; security: SecuritySummary } | { kind: "new" };

export const NEW_OPTION: SecurityOption = { kind: "new" };
const NEW_LABEL = "Neue Security anlegen";

export function optionLabel(option: SecurityOption): string {
  if (option.kind === "new") return NEW_LABEL;
  const { name, isin, cryptoSymbol } = option.security;
  return `${name} (${isin ?? cryptoSymbol ?? ""})`;
}

const baseFilter = createFilterOptions<SecurityOption>({
  // Case-insensitive substring match over ISIN, crypto symbol and name.
  stringify: (option) =>
    option.kind === "new"
      ? ""
      : [option.security.isin, option.security.cryptoSymbol, option.security.name].filter(Boolean).join(" "),
});

/** Matching Securities, then always "Neue Security anlegen" as the last option. */
export function filterSecurityOptions(
  options: SecurityOption[],
  state: Parameters<typeof baseFilter>[1],
): SecurityOption[] {
  const securities = options.filter((option) => option.kind === "security");
  return [...baseFilter(securities, state), NEW_OPTION];
}
