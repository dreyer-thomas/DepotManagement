import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { securityTypeLabel } from "@/app/_components/migration/labels";
import { allowedAssetTypes } from "@/modules/ledger";
import type { ManualPriceRow, SecurityPriceInfo, SecurityWithMapping } from "@/modules/prices";
import { fetchErrorText } from "../prices/price-labels";
import { PriceDate } from "../prices/StaleBadge";
import { mappingLabel } from "./labels";
import { LogoUploadButton } from "./LogoUploadDialog";
import { ManualPriceButton } from "./ManualPriceDialog";
import { ManualPriceList } from "./ManualPriceList";
import { MappingDialogButton, ResolveMappingButton } from "./MappingDialog";
import { SecurityLogo } from "./SecurityLogo";
import { TypeDialogButton } from "./TypeDialog";

/**
 * Securities with logo, name, ISIN or crypto symbol, type chip, price source and latest
 * price date (stale badge for held Securities), its manual Prices ("Manuelle Kurse" with edit/delete),
 * plus "Kursquelle bearbeiten", "Typ ändern", "Kurs manuell eintragen", (after a miss) "Automatisch
 * suchen" and "Logo hochladen" / "Logo ersetzen". A failed last fetch shows an error naming the provider; there "Kurs manuell eintragen" is
 * the Alert's action instead (one per card).
 */
export function SecurityList({
  securities,
  prices = {},
  manualPrices = {},
  today,
}: {
  securities: SecurityWithMapping[];
  /** Latest price info per Security id (`securityPriceInfo`); absent ids have no price. */
  prices?: Record<string, SecurityPriceInfo>;
  /** Manual Prices per Security id, newest first (`listManualPrices`). */
  manualPrices?: Record<string, ManualPriceRow[]>;
  /** Today's business date (default date of a manual Price). */
  today: string;
}) {
  return (
    <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {securities.map((security) => {
        const unclassified = security.assetType === "UNCLASSIFIED";
        const notFound = security.mapping !== null && security.mapping.provider === null;
        const price = prices[security.id];
        const fetchFailed = Boolean(security.mapping?.provider && security.mapping.fetchError);
        return (
          <li key={security.id}>
            <Card>
              <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                <Stack direction="row" sx={{ alignItems: "flex-start", gap: 2 }}>
                  <SecurityLogo securityId={security.id} name={security.name} />
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
                    {price ? (
                      <div>
                        <PriceDate info={price} />
                      </div>
                    ) : null}
                    {fetchFailed ? (
                      <Alert
                        severity="error"
                        sx={{ mt: 0.5, alignItems: "center", flexWrap: "wrap", rowGap: 1, "& .MuiAlert-action": { ml: 0, pl: 0 } }}
                        action={<ManualPriceButton security={security} today={today} />}
                      >
                        {fetchErrorText(security.mapping?.provider ?? null)}
                      </Alert>
                    ) : null}
                    <ManualPriceList security={security} prices={manualPrices[security.id] ?? []} today={today} />
                    <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", mt: 1, alignItems: "flex-start" }}>
                      <MappingDialogButton security={security} />
                      <TypeDialogButton security={security} allowedTypes={allowedAssetTypes(security)} />
                      {fetchFailed ? null : <ManualPriceButton security={security} today={today} />}
                      {notFound ? <ResolveMappingButton security={security} /> : null}
                      <LogoUploadButton security={security} />
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
