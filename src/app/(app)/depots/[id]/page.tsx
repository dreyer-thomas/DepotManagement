import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { type DepotTab, depotTab, depotTabId, depotTabPanelId } from "@/app/_components/depots/depot-tabs";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { DepotTabs } from "@/app/_components/depots/DepotTabs";
import { brokerLabel } from "@/app/_components/depots/labels";
import { readPeriod } from "@/app/_actions/period-cookie";
import { PeriodSelector } from "@/app/_components/period/PeriodSelector";
import { ValueSummary } from "@/app/_components/valuation/ValueSummary";
import { CashBookings } from "@/app/_components/cash/CashBookings";
import { CompositionCard } from "@/app/_components/composition/CompositionCard";
import { COMPOSITION_LABELS, compositionHoldings } from "@/app/_components/composition/labels";
import { NewTransactionButton } from "@/app/_components/transactions/TransactionDialog";
import { PositionsTable } from "@/app/_components/positions/PositionsTable";
import { TransactionList } from "@/app/_components/transactions/TransactionList";
import { businessDate } from "@/core/dates";
import { compositionByAssetType, compositionByPosition } from "@/core/composition";
import { formatMoney } from "@/core/format";
import { periodLabel } from "@/core/period";
import {
  depotValuation,
  getDepot,
  listCashBookings,
  listIsinChanges,
  listPositions,
  listSecurities,
  listSplits,
  listTransactions,
} from "@/modules/ledger";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const depot = await getDepot((await params).id);
  return { title: depot ? depot.name : "Depot nicht gefunden" };
}

function Message({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TabPanel({ tab, children }: { tab: DepotTab; children: ReactNode }) {
  return (
    <Box role="tabpanel" id={depotTabPanelId(tab)} aria-labelledby={depotTabId(tab)}>
      {children}
    </Box>
  );
}

export default async function DepotDetailPage({ params, searchParams }: Props) {
  const depot = await getDepot((await params).id);
  if (!depot) notFound();
  const tab = depotTab((await searchParams)?.tab);
  const today = businessDate(new Date());
  const period = await readPeriod(today);
  const [transactions, securities, splits, isinChanges, positions, cashBookings] = await Promise.all([
    listTransactions(depot.id),
    listSecurities(),
    tab === "cash" || tab === "composition" ? Promise.resolve([]) : listSplits(),
    tab === "positions" ? listIsinChanges() : Promise.resolve([]),
    // Stored manual / provider Prices win over Transaction prices (resolver); no provider call here.
    tab === "positions" || tab === "composition"
      ? listPositions(depot.id, today, undefined, { storedPrices: latestStoredPrices })
      : Promise.resolve([]),
    tab === "cash" ? listCashBookings(depot.id) : Promise.resolve([]),
  ]);
  const dialogDepot = { id: depot.id, name: depot.name };
  // An archived Depot is read-only (AD-17): no write action anywhere on the page.
  const readOnly = depot.archived;
  const newTransaction = readOnly ? null : (
    <NewTransactionButton depot={dialogDepot} securities={securities} today={today} />
  );
  // An empty Depot shows its only "Neue Buchung" button inside the empty state of every tab.
  const emptyState = transactions.length === 0;
  // Every summary figure comes from the core valuation series (AD-10); also for archived Depots.
  const valuation = emptyState
    ? null
    : await depotValuation(depot.id, period, today, undefined, { storedPrices: storedPriceHistory });
  const end = valuation?.series.at(-1);

  let content: ReactNode;
  if (emptyState) {
    content = (
      <Message>
        <Typography sx={readOnly ? undefined : { mb: 2 }}>Noch keine Buchungen.</Typography>
        {newTransaction}
      </Message>
    );
  } else if (tab === "transactions") {
    content = (
      <TransactionList
        transactions={transactions}
        depot={dialogDepot}
        securities={securities}
        today={today}
        splits={splits}
        readOnly={readOnly}
      />
    );
  } else if (tab === "positions") {
    content = (
      <PositionsTable
        positions={positions}
        depotId={depot.id}
        cashBalance={depot.cashBalance}
        today={today}
        splits={splits}
        isinChanges={isinChanges}
        securities={securities}
        readOnly={readOnly}
      />
    );
  } else if (tab === "composition") {
    // A today snapshot like the Positions tab: priced Positions plus the Cash Account (story 4-5).
    const holdings = compositionHoldings(depot, positions);
    content = (
      <CompositionCard
        headingId="depot-composition"
        views={[
          { view: "position", segments: compositionByPosition(holdings, depot.cashBalance, COMPOSITION_LABELS) },
          { view: "type", segments: compositionByAssetType(holdings, depot.cashBalance, COMPOSITION_LABELS) },
        ]}
      />
    );
  } else {
    content = <CashBookings balance={depot.cashBalance} bookings={cashBookings} />;
  }

  return (
    <>
      <Stack
        direction="row"
        sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 2, rowGap: 1 }}
      >
        <Typography variant="pageTitle" component="h1">
          {depot.name}
        </Typography>
        {emptyState ? null : <PeriodSelector period={period} today={today} />}
      </Stack>
      <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", rowGap: 1 }}>
        <Typography color="text.secondary">{brokerLabel(depot.broker)}</Typography>
        {readOnly ? <Chip label="Archiviert" size="small" /> : null}
        <Typography>
          Cash-Konto <Typography component="span" variant="figure">{formatMoney(depot.cashBalance)}</Typography>
        </Typography>
        {emptyState || !newTransaction ? null : <Box sx={{ ml: "auto !important" }}>{newTransaction}</Box>}
      </Stack>
      {readOnly ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Archiviertes Depot – nur lesbar. Reaktivieren unter <AppLink href="/settings">Einstellungen</AppLink>.
        </Alert>
      ) : null}
      {valuation && end ? (
        <ValueSummary
          value={end.value}
          investedCapital={end.investedCapital}
          cash={end.cash}
          dividends={valuation.dividends}
          taxesPaid={valuation.taxesPaid}
          periodLabel={periodLabel(period)}
          to={valuation.to}
          today={today}
          performance={valuation.performance}
          series={valuation.series}
        />
      ) : null}
      <DepotTabs depotId={depot.id} value={tab} />
      <TabPanel tab={tab}>{content}</TabPanel>
    </>
  );
}
