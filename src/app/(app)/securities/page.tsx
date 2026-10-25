import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { PageTitle } from "@/app/_components/Placeholder";
import { MappingAutoResolver } from "@/app/_components/securities/MappingAutoResolver";
import { SecurityList } from "@/app/_components/securities/SecurityList";
import { listSecuritiesWithMappings } from "@/modules/prices";

export const metadata: Metadata = { title: "Wertpapiere" };

/**
 * All Securities with their price source. Missing mappings are resolved by the client after render
 * (never during render or `next build`).
 */
export default async function SecuritiesPage() {
  const securities = await listSecuritiesWithMappings();
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
        <SecurityList securities={securities} />
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 3 }}>
        <Link href="https://www.coingecko.com" target="_blank" rel="noopener noreferrer" color="inherit">
          Data provided by CoinGecko
        </Link>
      </Typography>
    </>
  );
}
