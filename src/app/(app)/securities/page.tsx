import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { PageTitle } from "@/app/_components/Placeholder";
import { MappingAutoResolver } from "@/app/_components/securities/MappingAutoResolver";
import { PriceRefreshButton } from "@/app/_components/securities/PriceRefreshButton";
import { SecurityList } from "@/app/_components/securities/SecurityList";
import { businessDate } from "@/core/dates";
import { listAnalystSymbols, listClassifications, listRegionSplits } from "@/modules/classification";
import { listHeldSecurities } from "@/modules/ledger";
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
  const [securities, prices, manualPrices, classifications, teilfreistellungOverrides, regionSplits, analystSymbols, watched, held] = await Promise.all([
    listSecuritiesWithMappings(),
    securityPriceInfo(today),
    listManualPrices(),
    listClassifications(),
    listTeilfreistellungOverrides(),
    listRegionSplits(),
    listAnalystSymbols(),
    watchedSecurityIds(),
    listHeldSecurities(today),
  ]);
  const heldSet = new Set(held);
  const watchlistOnly = new Set(watched.filter((id) => !heldSet.has(id)));
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
