import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { securityTypeLabel } from "@/app/_components/migration/labels";
import { allowedAssetTypes } from "@/modules/ledger";
import type { SecurityWithMapping } from "@/modules/prices";
import { mappingLabel } from "./labels";
import { MappingDialogButton, ResolveMappingButton } from "./MappingDialog";
import { SecurityLogo } from "./SecurityLogo";
import { TypeDialogButton } from "./TypeDialog";

/**
 * Securities with logo placeholder, name, ISIN or crypto symbol, type chip and price source, plus
 * "Kursquelle bearbeiten", "Typ ändern" and (after a miss) "Automatisch suchen".
 */
export function SecurityList({ securities }: { securities: SecurityWithMapping[] }) {
  return (
    <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {securities.map((security) => {
        const unclassified = security.assetType === "UNCLASSIFIED";
        const notFound = security.mapping !== null && security.mapping.provider === null;
        return (
          <li key={security.id}>
            <Card>
              <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                <Stack direction="row" sx={{ alignItems: "flex-start", gap: 2 }}>
                  <SecurityLogo name={security.name} />
                  <Stack sx={{ flexGrow: 1, minWidth: 0, gap: 0.5 }}>
                    <Typography component="p" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                      {security.name}
                    </Typography>
                    <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Typography variant="body2" color="text.secondary">
                        {security.isin ?? security.cryptoSymbol}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={securityTypeLabel(security.assetType)}
                        color={unclassified ? "warning" : "default"}
                      />
                    </Stack>
                    <Typography variant="body2" color={security.mapping?.provider ? "text.primary" : "text.secondary"}>
                      {mappingLabel(security.mapping)}
                    </Typography>
                    <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", mt: 1, alignItems: "flex-start" }}>
                      <MappingDialogButton security={security} />
                      <TypeDialogButton security={security} allowedTypes={allowedAssetTypes(security)} />
                      {notFound ? <ResolveMappingButton security={security} /> : null}
                    </Stack>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </Stack>
  );
}
