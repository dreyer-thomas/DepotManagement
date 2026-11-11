import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { PageTitle } from "@/app/_components/Placeholder";
import { MappingAutoResolver } from "@/app/_components/securities/MappingAutoResolver";
import { PriceRefreshButton } from "@/app/_components/securities/PriceRefreshButton";
import type { PriceMarkBreachInfo } from "@/app/_components/price-marks/PriceMarkWarning";
import { SecurityList } from "@/app/_components/securities/SecurityList";
import { BENCHMARKS } from "@/core/benchmarks";
import { businessDate } from "@/core/dates";
import { listAnalystSymbols, listClassifications, listRegionSplits } from "@/modules/classification";
import { listHeldSecurities } from "@/modules/ledger";
import { breachedPriceMarks } from "@/modules/marks";
import { listManualPrices, listSecuritiesWithMappings, securityPriceInfo } from "@/modules/prices";
import { listTeilfreistellungOverrides } from "@/modules/tax";
import { watchedSecurityIds } from "@/modules/watchlist";

export const metadata: Metadata = { title: "Wertpapiere" };

/**
 * All Securities (watchlist-only ones marked "Watchlist") with their classification, Teilfreistellung and region split (funds), Analysten-Symbol (stocks), price source, latest price date and manual Prices. Missing mappings are resolved and
 * Prices refreshed by the client after render (never during render or `next build`).
 */
export default async function SecuritiesPage() {
  const today = businessDate(new Date());
  const [securities, prices, manualPrices, classifications, teilfreistellungOverrides, regionSplits, analystSymbols, watched, held, breached] = await Promise.all([
    listSecuritiesWithMappings(),
    securityPriceInfo(today),
    listManualPrices(),
    listClassifications(),
    listTeilfreistellungOverrides(),
    listRegionSplits(),
    listAnalystSymbols(),
    watchedSecurityIds(),
    listHeldSecurities(today),
    breachedPriceMarks(today),
  ]);
  // Story 12.4: warning icon at each Security with a breached mark (core state; "Nur Probleme" unaffected).
  const breaches: Record<string, PriceMarkBreachInfo> = {};
  for (const item of breached) {
    if (item.state.priceDate !== null) breaches[item.securityId] = { breach: item.state.breached, priceDate: item.state.priceDate };
  }
  const heldSet = new Set(held);
  const watchlistOnly = new Set(watched.filter((id) => !heldSet.has(id)));
  const benchmarkIsins = new Set(BENCHMARKS.map((benchmark) => benchmark.isin));
  const fetched = new Set([
    ...held,
    ...watched,
    ...securities.filter((security) => security.isin !== null && benchmarkIsins.has(security.isin)).map((security) => security.id),
  ]);
  const pending = securities.filter((security) => security.mapping === null).length;
  return (
    <>
      <PageTitle>Wertpapiere</PageTitle>
      <MappingAutoResolver pending={pending} />
      {securities.length === 0 ? (
        <Card>
          <CardContent>
            <Typography>Noch keine Wertpapiere.</Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <PriceRefreshButton />
          </Box>
          <SecurityList
            securities={securities}
            prices={prices}
            manualPrices={manualPrices}
            classifications={classifications}
            teilfreistellungOverrides={teilfreistellungOverrides}
            regionSplits={regionSplits}
            analystSymbols={analystSymbols}
            watchlistOnly={watchlistOnly}
            breaches={breaches}
            fetched={fetched}
            today={today}
          />
        </>
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 3 }}>
        <Link href="https://www.coingecko.com" target="_blank" rel="noopener noreferrer" color="inherit">
          Data provided by CoinGecko
        </Link>
      </Typography>
    </>
  );
}
