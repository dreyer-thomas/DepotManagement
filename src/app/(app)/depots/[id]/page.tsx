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
import { PageTitle } from "@/app/_components/Placeholder";
import { CashBookings } from "@/app/_components/cash/CashBookings";
import { NewTransactionButton } from "@/app/_components/transactions/TransactionDialog";
import { PositionsTable } from "@/app/_components/positions/PositionsTable";
import { TransactionList } from "@/app/_components/transactions/TransactionList";
import { businessDate } from "@/core/dates";
import { formatMoney } from "@/core/format";
import {
  getDepot,
  listCashBookings,
  listIsinChanges,
  listPositions,
  listSecurities,
  listSplits,
  listTransactions,
} from "@/modules/ledger";

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
  const [transactions, securities, splits, isinChanges, positions, cashBookings] = await Promise.all([
    listTransactions(depot.id),
    listSecurities(),
    tab === "cash" ? Promise.resolve([]) : listSplits(),
    tab === "positions" ? listIsinChanges() : Promise.resolve([]),
    tab === "positions" ? listPositions(depot.id, today) : Promise.resolve([]),
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
        cashBalance={depot.cashBalance}
        splits={splits}
        isinChanges={isinChanges}
        securities={securities}
        readOnly={readOnly}
      />
    );
  } else {
    content = <CashBookings balance={depot.cashBalance} bookings={cashBookings} />;
  }

  return (
    <>
      <PageTitle>{depot.name}</PageTitle>
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
      <DepotTabs depotId={depot.id} value={tab} />
      <TabPanel tab={tab}>{content}</TabPanel>
    </>
  );
}
