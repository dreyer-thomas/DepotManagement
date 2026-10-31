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
import type { AnalystSymbolInfo, RegionSplitInfo } from "@/modules/classification";
import type { ManualPriceRow, SecurityPriceInfo, SecurityWithMapping } from "@/modules/prices";
import { fetchErrorText } from "../prices/price-labels";
import { PriceDate } from "../prices/StaleBadge";
import { AnalystSymbolButton } from "./AnalystSymbolDialog";
import { ClassificationButton } from "./ClassificationDialog";
import { analystSymbolSummary, classificationSummary, mappingLabel, regionSplitSummary } from "./labels";
import { LogoUploadButton } from "./LogoUploadDialog";
import { ManualPriceButton } from "./ManualPriceDialog";
import { ManualPriceList } from "./ManualPriceList";
import { MappingDialogButton, ResolveMappingButton } from "./MappingDialog";
import { RegionSplitButton } from "./RegionSplitDialog";
import { SecurityEditMenu } from "./SecurityEditMenu";
import { SecurityPriceRefreshButton } from "./SecurityPriceRefreshButton";
import { SecuritySearch } from "./SecuritySearch";
import { SecurityLink } from "../security-detail/SecurityLink";
import { teilfreistellungSummary } from "../tax/labels";
import { TeilfreistellungButton } from "../tax/TeilfreistellungDialog";
import { SecurityLogo } from "./SecurityLogo";
import { TypeDialogButton } from "./TypeDialog";

/**
 * Securities with logo, name, ISIN or crypto symbol, type chip ("Watchlist" chip when only watched), classification summary
 * ("Aktien · Technologie · Europa · …", unknown values "Unbekannt"), price source and latest price date (stale badge for held Securities), its manual Prices ("Manuelle Kurse" with edit/delete),
 * plus "Kurs abrufen" (mapped Securities), (after a miss) "Automatisch suchen", and "Bearbeiten" (pencil) opening a popup
 * with "Kursquelle bearbeiten", "Typ ändern", "Klassifizierung", "Kurs manuell eintragen", "Logo hochladen" / "Logo ersetzen" and, for funds (ETF/FUND), "Teilfreistellung" with its summary line
 * ("Teilfreistellung 30 % (automatisch|manuell)"), plus "Regionen" with the region split line when the fund has one
 * ("Regionen: USA 72 % · … (Regel MSCI World, Stand 30.09.2026)" / "(manuell)", story 8.4), and for stocks the
 * line "Analysten-Symbol: AAPL" / "… automatisch" with its button "Analysten-Symbol" (story 9.7). A failed last fetch shows an error naming the provider and the reason; there "Kurs manuell eintragen" is
 * the Alert's action instead (one per card). A search field and the "Nur Probleme" switch above the list filter it (`SecuritySearch`).
 */
export function SecurityList({
  securities,
  prices = {},
  manualPrices = {},
  classifications = {},
  teilfreistellungOverrides = {},
  regionSplits = {},
  analystSymbols = {},
  watchlistOnly = new Set(),
  fetched,
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
  /** Analysten-Symbol per Security id (`listAnalystSymbols`); absent ids are automatic. */
  analystSymbols?: Record<string, AnalystSymbolInfo>;
  /** Securities on ≥ 1 watchlist and not held (story 9.2): chip "Watchlist". */
  watchlistOnly?: ReadonlySet<string>;
  /**
   * Securities the price runs fetch (held, watched or a benchmark); only these get "Kurs abrufen" and count for
   * "Nur Probleme". Absent: all Securities.
   */
  fetched?: ReadonlySet<string>;
  /** Today's business date (default date of a manual Price). */
  today: string;
}) {
  const items = securities.map((security) => {
    const unclassified = security.assetType === "UNCLASSIFIED";
    const isFetched = fetched?.has(security.id) ?? true;
    const notFound = security.mapping !== null && security.mapping.provider === null;
    const price = prices[security.id];
    const fetchFailed = Boolean(security.mapping?.provider && security.mapping.fetchError);
    const classification = classifications[security.id] ?? effective(null, security.assetType as ClassifiedAssetType);
    const fund = security.assetType === "ETF" || security.assetType === "FUND";
    const stock = security.assetType === "STOCK";
    const analystSymbol = analystSymbols[security.id]?.symbol ?? null;
    const override = teilfreistellungOverrides[security.id] ?? null;
    const regionSplit = fund ? (regionSplits[security.id]?.effective ?? null) : null;
    const regionSummary = regionSplitSummary(regionSplit);
    const automaticRate = taxSecurity({ type: security.assetType, assetClass: classification.assetClass.value }, null).teilfreistellung;
    const text = [security.name, security.isin, security.cryptoSymbol, security.mapping?.symbol, securityTypeLabel(security.assetType)]
      .filter(Boolean)
      .join(" ");
    const node = (
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
                  {watchlistOnly.has(security.id) ? <Chip size="small" variant="outlined" color="primary" label="Watchlist" /> : null}
                </Stack>
                <Typography variant="body2">{classificationSummary(classification)}</Typography>
                {fund ? <Typography variant="body2">{teilfreistellungSummary(override ?? automaticRate, override !== null)}</Typography> : null}
                {regionSummary ? <Typography variant="body2">{regionSummary}</Typography> : null}
                {stock ? <Typography variant="body2">{analystSymbolSummary(analystSymbol)}</Typography> : null}
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
                    {fetchErrorText(security.mapping?.provider ?? null, security.mapping?.fetchError)}
                  </Alert>
                ) : null}
                <ManualPriceList security={security} prices={manualPrices[security.id] ?? []} today={today} />
                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", mt: 1, alignItems: "flex-start" }}>
                  {isFetched && security.mapping?.provider ? (
                    <SecurityPriceRefreshButton security={security} provider={security.mapping.provider} />
                  ) : null}
                  {notFound ? <ResolveMappingButton security={security} /> : null}
                  <SecurityEditMenu name={security.name}>
                    <MappingDialogButton security={security} />
                    <TypeDialogButton security={security} allowedTypes={allowedAssetTypes(security)} />
                    <ClassificationButton security={security} classification={classification} />
                    {fund ? <TeilfreistellungButton security={security} automaticRate={automaticRate} override={override} /> : null}
                    {fund ? <RegionSplitButton security={security} weights={regionSplit?.weights ?? null} /> : null}
                    {stock ? <AnalystSymbolButton security={security} symbol={analystSymbol} /> : null}
                    {fetchFailed ? null : <ManualPriceButton security={security} today={today} />}
                    <LogoUploadButton security={security} />
                  </SecurityEditMenu>
                </Stack>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </li>
    );
    // Shown by "Nur Probleme": a fetched Security with a stale or missing Price, a failed last fetch, or no price source
    // found. A Security that is neither held, watched nor a benchmark is never fetched, so it cannot be repaired here.
    const problem = isFetched && (!price || price.stale || fetchFailed || notFound);
    return { id: security.id, text, problem, node };
  });
  return <SecuritySearch items={items} />;
}
