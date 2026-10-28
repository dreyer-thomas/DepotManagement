import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { readPeriod } from "@/app/_actions/period-cookie";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { type DepotFigures, DepotGroups } from "@/app/_components/depots/DepotList";
import { PeriodSelector } from "@/app/_components/period/PeriodSelector";
import { businessDate } from "@/core/dates";
import { periodLabel } from "@/core/period";
import { listDepots, listPositions, portfolioValuation } from "@/modules/ledger";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";

export const metadata: Metadata = { title: "Depots" };

/**
 * Depots list for the stored Period: each active Depot card shows its value, Period Gain/Loss,
 * sparkline and figures (as on the Overview); archived Depots stay plain in their collapsed group.
 */
export default async function DepotsPage() {
  const today = businessDate(new Date());
  const period = await readPeriod(today);
  const label = periodLabel(period);
  const depots = await listDepots();
  const figures: Record<string, DepotFigures> = {};
  if (depots.some((depot) => !depot.archived)) {
    const portfolio = await portfolioValuation(period, today, undefined, { storedPrices: storedPriceHistory });
    // Stored manual / provider Prices win over Transaction prices (resolver), as on the Positions tab.
    const positions = await Promise.all(
      portfolio.depots.map((depot) => listPositions(depot.id, today, undefined, { storedPrices: latestStoredPrices })),
    );
    portfolio.depots.forEach(({ id, valuation }, index) => {
      const end = valuation.series.at(-1) ?? valuation.start;
      figures[id] = {
        value: end.value,
        positionsValue: end.positionsValue,
        cash: end.cash,
        positionCount: positions[index].length,
        gain: valuation.performance.gain,
        dividends: valuation.dividends,
        ttwror: valuation.performance.ttwror,
        xirr: valuation.performance.xirr,
        values: valuation.series.map((point) => point.value),
      };
    });
  }
  return (
    <>
      <Stack
        direction="row"
        sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 2, rowGap: 1 }}
      >
        <Typography variant="pageTitle" component="h1">
          Depots
        </Typography>
        <PeriodSelector period={period} today={today} />
      </Stack>
      <Box sx={{ mb: 2 }}>
        <CreateDepotButton />
      </Box>
      {depots.length === 0 ? (
        <Card>
          <CardContent>
            <Typography>Noch kein Depot.</Typography>
          </CardContent>
        </Card>
      ) : (
        <DepotGroups depots={depots} figures={figures} periodLabel={label} />
      )}
    </>
  );
}
