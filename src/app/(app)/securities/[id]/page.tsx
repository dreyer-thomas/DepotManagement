import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readMovingAverage, readSecurityChartMode } from "@/app/_actions/chart-preference-cookie";
import { readPeriod } from "@/app/_actions/period-cookie";
import { BackLink } from "@/app/_components/back-navigation/BackLink";
import { NewsList } from "@/app/_components/news/NewsList";
import { ClassificationButton } from "@/app/_components/securities/ClassificationDialog";
import { classificationSummary } from "@/app/_components/securities/labels";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import { PeriodSelector } from "@/app/_components/period/PeriodSelector";
import { toChartPoints } from "@/app/_components/charts/value-chart";
import { DepotSwitcher } from "@/app/_components/security-detail/DepotSwitcher";
import { FifoLots } from "@/app/_components/security-detail/FifoLots";
import { KeyFiguresCard } from "@/app/_components/security-detail/KeyFiguresCard";
import { securityCaption } from "@/app/_components/security-detail/labels";
import { PriceLine } from "@/app/_components/security-detail/PriceLine";
import { SecurityActions } from "@/app/_components/security-detail/SecurityActions";
import { SecurityChart } from "@/app/_components/security-detail/SecurityChart";
import { SecurityHeatmap } from "@/app/_components/security-detail/SecurityHeatmap";
import { SecurityHero } from "@/app/_components/security-detail/SecurityHero";
import { SecurityKpis } from "@/app/_components/security-detail/SecurityKpis";
import { SecurityTotal } from "@/app/_components/security-detail/SecurityTotal";
import { SecurityTransactions } from "@/app/_components/security-detail/SecurityTransactions";
import { WatchHeader } from "@/app/_components/security-detail/WatchHeader";
import { WatchlistCard } from "@/app/_components/security-detail/WatchlistCard";
import { WatchlistChips } from "@/app/_components/security-detail/WatchlistChips";
import { AddToWatchlistButton } from "@/app/_components/watchlists/WatchlistEntryDialog";
import { SecurityLogo } from "@/app/_components/securities/SecurityLogo";
import { type ClassifiedAssetType, effective } from "@/core/classification";
import { businessDate } from "@/core/dates";
import { ExactDecimal } from "@/core/decimal";
import { periodLabel } from "@/core/period";
import { getSecurity, listHeldSecurities, listIsinChanges, listSecurities, listSplits, securityDetail } from "@/modules/ledger";
import { listClassifications, listKeyFigures } from "@/modules/classification";
import { listSecurityNews } from "@/modules/news";
import { storedPriceHistory } from "@/modules/prices";
import { listWatchlists, securityWatchlistEntries } from "@/modules/watchlist";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ depot?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const security = await getSecurity((await params).id);
  return { title: security ? security.name : "Wertpapier nicht gefunden" };
}

/**
 * One Security across all Depots or one Depot (story 4-6), also when no longer held: header with the
 * watchlist chips, Period selector, "Zur Watchlist" and the actions menu, Depot switcher, hero (value,
 * Period gain/loss, TTWROR, XIRR, price line, Kurs/Wert/Performance/Drawdown chart with the optional
 * moving average, breakdown), KPIs, "Gesamt seit Erstkauf" (story 4-7), "Kennzahlen" (story 9.6), "Performance-Heatmap" (story
 * 7-8), open FIFO lots, Transaction history and 14-day news. A never-booked Security (story 9.2) gets
 * the watch layout instead: Price header with the Period change and the Kurs chart, "Auf Watchlists",
 * "Kennzahlen", news and classification — no holding or Transaction blocks. Every figure comes from `core` via
 * `securityDetail` (AD-10); no provider call during render.
 */
export default async function SecurityDetailPage({ params, searchParams }: Props) {
  const id = (await params).id;
  const depotParam = (await searchParams)?.depot;
  const today = businessDate(new Date());
  const period = await readPeriod(today);
  const detail = await securityDetail(id, Array.isArray(depotParam) ? depotParam[0] : depotParam, period, today, undefined, {
    storedPrices: storedPriceHistory,
  });
  if (!detail) notFound();
  const { security } = detail;
  const booked = detail.depots.length > 0;
  const [splits, isinChanges, securities, articles, chartMode, movingAverage, watchlists, entries, classifications, keyFigures, heldIds] = await Promise.all([
    listSplits(),
    listIsinChanges(),
    listSecurities(),
    listSecurityNews(today, security.id),
    readSecurityChartMode(),
    readMovingAverage(),
    listWatchlists(),
    securityWatchlistEntries(security.id, today),
    booked ? Promise.resolve(null) : listClassifications(),
    listKeyFigures([security.id], today),
    listHeldSecurities(today),
  ]);
  const watchlistOptions = watchlists.map(({ id: listId, name }) => ({ id: listId, name }));
  const onLists = entries.map((entry) => ({ id: entry.watchlistId, name: entry.watchlistName }));

  // "Neue Buchung": the selected Depot when it is not archived; for "Alle Depots" every non-archived booking Depot.
  const transactionDepots = detail.depots
    .filter((depot) => !depot.archived && (detail.selected === null || depot.id === detail.selected))
    .map(({ id: depotId, name }) => ({ id: depotId, name }));
  const end = detail.series.at(-1) ?? detail.start;
  const held = new ExactDecimal(detail.snapshot.quantity).greaterThan(0);
  // Watch layout only (`classifications` is not loaded for a booked Security).
  const classification = classifications?.[security.id] ?? effective(null, security.assetType as ClassifiedAssetType);
  // Key figures (story 9.6): refreshable for a held or watched STOCK/ETF/FUND with a Yahoo mapping.
  const keyFigureInfo = keyFigures[security.id];
  const keyFiguresCard = (
    <KeyFiguresCard
      securityId={security.id}
      assetType={security.assetType}
      snapshot={keyFigureInfo?.snapshot ?? null}
      fiftyTwoWeek={detail.fiftyTwoWeek}
      canRefresh={Boolean(keyFigureInfo?.refreshable) && (heldIds.includes(security.id) || entries.length > 0)}
      today={today}
    />
  );
  const news = (
    <Box component="section" aria-labelledby="security-news">
      <CardHeading id="security-news">Nachrichten · 14 Tage</CardHeading>
      <NewsList articles={articles} />
    </Box>
  );

  return (
    <>
      <BackLink parent={{ href: "/securities", label: "Wertpapiere" }} self={security.name} />
      <Stack direction="row" sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", columnGap: 2, rowGap: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0, flex: "1 1 auto" }}>
          <SecurityLogo securityId={security.id} name={security.name} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="pageTitle" component="h1" sx={{ overflowWrap: "anywhere" }}>
              {security.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {securityCaption(security)}
            </Typography>
            <WatchlistChips lists={onLists} />
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <PeriodSelector period={period} today={today} />
          <AddToWatchlistButton security={security} lists={watchlistOptions} onLists={onLists.map((list) => list.id)} today={today} />
          <SecurityActions
            security={security}
            splits={splits}
            isinChanges={isinChanges}
            securities={securities}
            transactionDepots={transactionDepots}
            today={today}
          />
        </Stack>
      </Stack>
      {booked ? (
        <>
          <DepotSwitcher securityId={security.id} depots={detail.depots} selected={detail.selected} />
          <SecurityHero
            quantity={detail.snapshot.quantity}
            price={detail.price?.price ?? null}
            value={end.value}
            to={detail.to}
            today={today}
            performance={detail.performance}
            priceLine={<PriceLine price={detail.price} security={detail.priceSecurity} held={held} today={today} />}
            chart={
              <SecurityChart
                valuePoints={toChartPoints(detail.series)}
                pricePoints={detail.priceSeries}
                trades={detail.trades.map(({ depotName, type, date, quantity, price, adjusted }) => ({
                  depotName,
                  type,
                  date,
                  quantity,
                  price,
                  adjusted,
                }))}
                drawdown={detail.drawdown}
                dividends={detail.dividends.map(({ depotName, date, amount }) => ({ depotName, date, amount }))}
                performance={detail.performanceLine}
                movingAverages={detail.movingAverages}
                initialMode={chartMode}
                initialMovingAverage={movingAverage}
              />
            }
          />
          <SecurityKpis snapshot={detail.snapshot} dividends={detail.performance.dividends} periodLabel={periodLabel(period)} />
          <SecurityTotal total={detail.total} />
          {keyFiguresCard}
          <SecurityHeatmap scope={detail.selected ?? "all"} years={detail.heatmap} />
          <FifoLots groups={detail.lots} />
          <SecurityTransactions
            securityId={security.id}
            transactions={detail.transactions}
            splits={splits}
            isinChanges={isinChanges}
            today={today}
          />
          {news}
        </>
      ) : (
        <>
          <WatchHeader
            price={detail.price}
            security={detail.priceSecurity}
            priceChange={detail.priceChange}
            periodLabel={periodLabel(period)}
            fetched={entries.length > 0}
            to={detail.to}
            today={today}
            chart={
              detail.price === null ? undefined : (
                <SecurityChart
                  valuePoints={[]}
                  pricePoints={detail.priceSeries}
                  trades={[]}
                  movingAverages={detail.movingAverages}
                  initialMode={chartMode}
                  initialMovingAverage={movingAverage}
                />
              )
            }
          />
          <WatchlistCard entries={entries} lists={watchlistOptions} security={security} today={today} />
          {keyFiguresCard}
          <Box sx={{ mb: 1.5 }}>{news}</Box>
          <Box component="section" aria-labelledby="security-classification">
            <Card>
              <CardContent>
                <CardHeading id="security-classification">Klassifizierung</CardHeading>
                <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
                  <Typography variant="body2">{classificationSummary(classification)}</Typography>
                  <ClassificationButton security={security} classification={classification} />
                </Stack>
              </CardContent>
            </Card>
          </Box>
        </>
      )}
    </>
  );
}
