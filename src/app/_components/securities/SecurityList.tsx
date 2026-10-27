import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { securityTypeLabel } from "@/app/_components/migration/labels";
import { type Classification, type ClassifiedAssetType, effective } from "@/core/classification";
import { taxSecurity } from "@/core/tax";
import { allowedAssetTypes } from "@/modules/ledger";
import type { RegionSplitInfo } from "@/modules/classification";
import type { ManualPriceRow, SecurityPriceInfo, SecurityWithMapping } from "@/modules/prices";
import { fetchErrorText } from "../prices/price-labels";
import { PriceDate } from "../prices/StaleBadge";
import { ClassificationButton } from "./ClassificationDialog";
import { classificationSummary, mappingLabel, regionSplitSummary } from "./labels";
import { LogoUploadButton } from "./LogoUploadDialog";
import { ManualPriceButton } from "./ManualPriceDialog";
import { ManualPriceList } from "./ManualPriceList";
import { MappingDialogButton, ResolveMappingButton } from "./MappingDialog";
import { RegionSplitButton } from "./RegionSplitDialog";
import { SecurityLink } from "../security-detail/SecurityLink";
import { teilfreistellungSummary } from "../tax/labels";
import { TeilfreistellungButton } from "../tax/TeilfreistellungDialog";
import { SecurityLogo } from "./SecurityLogo";
import { TypeDialogButton } from "./TypeDialog";

/**
 * Securities with logo, name, ISIN or crypto symbol, type chip, classification summary
 * ("Aktien · Technologie · Europa · …", unknown values "Unbekannt"), price source and latest price date (stale badge for held Securities), its manual Prices ("Manuelle Kurse" with edit/delete),
 * plus "Kursquelle bearbeiten", "Typ ändern", "Klassifizierung", "Kurs manuell eintragen", (after a miss) "Automatisch
 * suchen", "Logo hochladen" / "Logo ersetzen" and, for funds (ETF/FUND), "Teilfreistellung" with its summary line
 * ("Teilfreistellung 30 % (automatisch|manuell)"), plus "Regionen" with the region split line when the fund has one
 * ("Regionen: USA 72 % · … (Regel MSCI World, Stand 30.09.2026)" / "(manuell)", story 8.4). A failed last fetch shows an error naming the provider; there "Kurs manuell eintragen" is
 * the Alert's action instead (one per card).
 */
export function SecurityList({
  securities,
  prices = {},
  manualPrices = {},
  classifications = {},
  teilfreistellungOverrides = {},
  regionSplits = {},
  today,
}: {
  securities: SecurityWithMapping[];
  /** Latest price info per Security id (`securityPriceInfo`); absent ids have no price. */
  prices?: Record<string, SecurityPriceInfo>;
  /** Manual Prices per Security id, newest first (`listManualPrices`). */
  manualPrices?: Record<string, ManualPriceRow[]>;
  /** Effective classification per Security id (`listClassifications`); absent ids are all unknown. */
  classifications?: Record<string, Classification>;
  /** Manual Teilfreistellung per Security id (`listTeilfreistellungOverrides`); absent ids are automatic. */
  teilfreistellungOverrides?: Record<string, string>;
  /** Region split per Security id (`listRegionSplits`); absent ids have none. */
  regionSplits?: Record<string, RegionSplitInfo>;
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
        const classification = classifications[security.id] ?? effective(null, security.assetType as ClassifiedAssetType);
        const fund = security.assetType === "ETF" || security.assetType === "FUND";
        const override = teilfreistellungOverrides[security.id] ?? null;
        const regionSplit = fund ? (regionSplits[security.id]?.effective ?? null) : null;
        const regionSummary = regionSplitSummary(regionSplit);
        const automaticRate = taxSecurity({ type: security.assetType, assetClass: classification.assetClass.value }, null).teilfreistellung;
        return (
          <li key={security.id}>
            <Card>
              <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                <Stack direction="row" sx={{ alignItems: "flex-start", gap: 2 }}>
                  <SecurityLogo securityId={security.id} name={security.name} />
                  <Stack sx={{ flexGrow: 1, minWidth: 0, gap: 0.5 }}>
                    <Typography component="p" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                      <SecurityLink securityId={security.id}>{security.name}</SecurityLink>
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
                    <Typography variant="body2">{classificationSummary(classification)}</Typography>
                    {fund ? <Typography variant="body2">{teilfreistellungSummary(override ?? automaticRate, override !== null)}</Typography> : null}
                    {regionSummary ? <Typography variant="body2">{regionSummary}</Typography> : null}
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
                      <ClassificationButton security={security} classification={classification} />
                      {fund ? <TeilfreistellungButton security={security} automaticRate={automaticRate} override={override} /> : null}
                      {fund ? <RegionSplitButton security={security} weights={regionSplit?.weights ?? null} /> : null}
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
