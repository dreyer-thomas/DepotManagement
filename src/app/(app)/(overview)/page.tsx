import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readPeriod } from "@/app/_actions/period-cookie";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { ParqetMigrationLink } from "@/app/_components/migration/ParqetMigrationLink";
import { DepotPerformance, type DepotPerformanceRow } from "@/app/_components/overview/DepotPerformance";
import { LATEST_NEWS, LatestNews } from "@/app/_components/overview/LatestNews";
import { type DepotPosition, topPositions } from "@/app/_components/overview/labels";
import { NewTransactionFab } from "@/app/_components/overview/NewTransactionFab";
import { StaleAlert } from "@/app/_components/overview/StaleAlert";
import { TopPositions } from "@/app/_components/overview/TopPositions";
import { PeriodSelector } from "@/app/_components/period/PeriodSelector";
import { PageTitle } from "@/app/_components/Placeholder";
import { ValueSummary } from "@/app/_components/valuation/ValueSummary";
import { businessDate } from "@/core/dates";
import { periodLabel } from "@/core/period";
import { listDepots, listPositions, listSecurities, portfolioValuation } from "@/modules/ledger";
import { listNews } from "@/modules/news";
import { latestStoredPrices, securityPriceInfo, storedPriceHistory } from "@/modules/prices";

export const metadata: Metadata = { title: "Übersicht" };

function Message({ children }: { children: ReactNode }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 2, rowGap: 1 }}
    >
      <Typography variant="pageTitle" component="h1">
        Übersicht
      </Typography>
      {children}
    </Stack>
  );
}

/**
 * The Portfolio (non-archived Depots, AD-17) for the stored Period: hero and KPI row, top Positions,
 * latest headlines and the Depots with their Period figures. Every figure comes from `core` via
 * `portfolioValuation` (AD-10); no provider call during render.
 */
export default async function OverviewPage() {
  const all = await listDepots();
  if (all.length === 0) {
    return (
      <>
        <PageTitle>Übersicht</PageTitle>
        <Card>
          <CardContent>
            <Typography sx={{ mb: 2 }}>Noch kein Depot.</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <CreateDepotButton label="Depot anlegen" />
              <ParqetMigrationLink />
            </Stack>
          </CardContent>
        </Card>
      </>
    );
  }
  // Archived Depots are left out of the Overview (AD-17).
  const depots = all.filter((depot) => !depot.archived);
  if (depots.length === 0) {
    return (
      <>
        <PageTitle>Übersicht</PageTitle>
        <Card>
          <CardContent>
            <Typography sx={{ mb: 1 }}>Alle Depots sind archiviert.</Typography>
            <AppLink href="/depots">Zu den Depots</AppLink>
          </CardContent>
        </Card>
      </>
    );
  }

  const today = businessDate(new Date());
  const period = await readPeriod(today);
  const label = periodLabel(period);
  const [portfolio, securities] = await Promise.all([
    portfolioValuation(period, today, undefined, { storedPrices: storedPriceHistory }),
    listSecurities(),
  ]);
  const rows: DepotPerformanceRow[] = portfolio.depots.map(({ id, name, valuation }) => ({
    id,
    name,
    value: valuation.series.at(-1)?.value ?? "0",
    gain: valuation.performance.gain,
    ttwror: valuation.performance.ttwror,
    xirr: valuation.performance.xirr,
  }));
  const dialogDepots = portfolio.depots.map(({ id, name }) => ({ id, name }));
  const fab = <NewTransactionFab depots={dialogDepots} securities={securities} today={today} />;
  const depotsCard = <DepotPerformance rows={rows} periodLabel={label} />;

  if (!portfolio.hasTransactions) {
    return (
      <>
        <Header />
        <Message>
          <Typography>Noch keine Buchungen.</Typography>
        </Message>
        {depotsCard}
        {fab}
      </>
    );
  }

  const [priceInfo, positionsByDepot, news] = await Promise.all([
    securityPriceInfo(today),
    // Stored manual / provider Prices win over Transaction prices (resolver), as on the Positions tab.
    Promise.all(portfolio.depots.map((depot) => listPositions(depot.id, today, undefined, { storedPrices: latestStoredPrices }))),
    listNews(today),
  ]);
  const staleCount = Object.values(priceInfo).filter((info) => info.stale).length;
  const held: DepotPosition[] = portfolio.depots.flatMap((depot, index) =>
    positionsByDepot[index].map((position) => ({ depotName: depot.name, position })),
  );
  const end = portfolio.series.at(-1) ?? portfolio.start;

  return (
    <>
      <Header>
        <PeriodSelector period={period} today={today} />
      </Header>
      <StaleAlert count={staleCount} />
      <ValueSummary
        label="Portfoliowert"
        value={end.value}
        investedCapital={end.investedCapital}
        cash={end.cash}
        dividends={portfolio.dividends}
        taxesPaid={portfolio.taxesPaid}
        periodLabel={label}
        to={portfolio.to}
        today={today}
        performance={portfolio.performance}
        series={portfolio.series}
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1.5fr) minmax(0, 1fr)" },
          gap: 1.5,
          mb: 2,
        }}
      >
        <TopPositions entries={topPositions(held)} today={today} />
        <LatestNews articles={news.articles.slice(0, LATEST_NEWS)} />
      </Box>
      {depotsCard}
      {fab}
    </>
  );
}
