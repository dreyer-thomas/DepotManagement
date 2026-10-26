import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readPeriod } from "@/app/_actions/period-cookie";
import { NewsList } from "@/app/_components/news/NewsList";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import { PeriodSelector } from "@/app/_components/period/PeriodSelector";
import { DepotSwitcher } from "@/app/_components/security-detail/DepotSwitcher";
import { FifoLots } from "@/app/_components/security-detail/FifoLots";
import { NO_TRANSACTIONS_TEXT, securityCaption } from "@/app/_components/security-detail/labels";
import { PriceLine } from "@/app/_components/security-detail/PriceLine";
import { SecurityActions } from "@/app/_components/security-detail/SecurityActions";
import { SecurityHero } from "@/app/_components/security-detail/SecurityHero";
import { SecurityKpis } from "@/app/_components/security-detail/SecurityKpis";
import { SecurityTransactions } from "@/app/_components/security-detail/SecurityTransactions";
import { SecurityLogo } from "@/app/_components/securities/SecurityLogo";
import { businessDate } from "@/core/dates";
import { ExactDecimal } from "@/core/decimal";
import { periodLabel } from "@/core/period";
import { getSecurity, listIsinChanges, listSecurities, listSplits, securityDetail } from "@/modules/ledger";
import { listNews } from "@/modules/news";
import { storedPriceHistory } from "@/modules/prices";

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
 * actions menu, Depot switcher, hero (value, Period gain/loss, TTWROR, XIRR, price line, chart,
 * breakdown), KPIs, open FIFO lots, Transaction history and 14-day news. Every figure comes from
 * `core` via `securityDetail` (AD-10); no provider call during render.
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
  const [splits, isinChanges, securities, news] = await Promise.all([
    listSplits(),
    listIsinChanges(),
    listSecurities(),
    booked ? listNews(today, security.id) : Promise.resolve(null),
  ]);

  // "Neue Buchung": the selected Depot when it is not archived; for "Alle Depots" every non-archived booking Depot.
  const transactionDepots = detail.depots
    .filter((depot) => !depot.archived && (detail.selected === null || depot.id === detail.selected))
    .map(({ id: depotId, name }) => ({ id: depotId, name }));
  const end = detail.series.at(-1) ?? detail.start;
  const held = new ExactDecimal(detail.snapshot.quantity).greaterThan(0);
  // listNews lists every held Security's news for a non-held id: keep this Security's only.
  const articles = news?.articles.filter((article) => article.securityId === security.id) ?? [];

  return (
    <>
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
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          {booked ? <PeriodSelector period={period} today={today} /> : null}
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
            series={detail.series}
            priceLine={<PriceLine price={detail.price} security={detail.priceSecurity} held={held} today={today} />}
          />
          <SecurityKpis snapshot={detail.snapshot} dividends={detail.performance.dividends} periodLabel={periodLabel(period)} />
          <FifoLots groups={detail.lots} />
          <SecurityTransactions securityId={security.id} transactions={detail.transactions} splits={splits} today={today} />
          <Box component="section" aria-labelledby="security-news">
            <CardHeading id="security-news">Nachrichten · 14 Tage</CardHeading>
            <NewsList articles={articles} />
          </Box>
        </>
      ) : (
        <Card>
          <CardContent>
            <Typography>{NO_TRANSACTIONS_TEXT}</Typography>
          </CardContent>
        </Card>
      )}
    </>
  );
}
