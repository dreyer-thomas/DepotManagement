"use client";

import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { ALLOCATION_DIMENSIONS, type AllocationDimension, PORTFOLIO_LABEL, PORTFOLIO_SCOPE, allocationHref } from "./labels";

/** "Bereich" (Portfolio or one non-archived Depot) and "Dimension"; each change replaces the URL, keeping the other. */
export function AnalysisFilters({
  depots,
  scope,
  dimension,
}: {
  depots: readonly { id: string; name: string }[];
  scope: string;
  dimension: AllocationDimension;
}) {
  const router = useRouter();
  const navigate = (nextScope: string, nextDimension: AllocationDimension) =>
    router.replace(allocationHref(nextScope, nextDimension), { scroll: false });
  const field = { width: { xs: "100%", sm: 260 } } as const;
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
      <TextField
        select
        label="Bereich"
        value={scope}
        onChange={(event) => navigate(event.target.value, dimension)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={field}
      >
        <MenuItem value={PORTFOLIO_SCOPE} sx={{ minHeight: 44 }}>
          {PORTFOLIO_LABEL}
        </MenuItem>
        {depots.map((depot) => (
          <MenuItem key={depot.id} value={depot.id} sx={{ minHeight: 44 }}>
            {depot.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Dimension"
        value={dimension}
        onChange={(event) => navigate(scope, event.target.value as AllocationDimension)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={field}
      >
        {(Object.entries(ALLOCATION_DIMENSIONS) as [AllocationDimension, string][]).map(([key, label]) => (
          <MenuItem key={key} value={key} sx={{ minHeight: 44 }}>
            {label}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
