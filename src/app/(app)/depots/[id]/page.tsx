import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { type DepotTab, depotTab, depotTabId, depotTabPanelId } from "@/app/_components/depots/depot-tabs";
import { DepotTabs } from "@/app/_components/depots/DepotTabs";
import { brokerLabel } from "@/app/_components/depots/labels";
import { PageTitle } from "@/app/_components/Placeholder";
import { NewTransactionButton } from "@/app/_components/transactions/TransactionDialog";
import { TransactionList } from "@/app/_components/transactions/TransactionList";
import { businessDate } from "@/core/dates";
import { formatMoney } from "@/core/format";
import { getDepot, listSecurities, listTransactions } from "@/modules/ledger";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const depot = await getDepot((await params).id);
  return { title: depot ? depot.name : "Depot nicht gefunden" };
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
  const [transactions, securities] = await Promise.all([listTransactions(depot.id), listSecurities()]);
  const newTransaction = (
    <NewTransactionButton depotId={depot.id} securities={securities} today={businessDate(new Date())} />
  );
  const emptyTransactions = tab === "transactions" && transactions.length === 0;

  return (
    <>
      <PageTitle>{depot.name}</PageTitle>
      <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", rowGap: 1 }}>
        <Typography color="text.secondary">{brokerLabel(depot.broker)}</Typography>
        <Typography>
          Cash-Konto <Typography component="span" variant="figure">{formatMoney(depot.cashBalance)}</Typography>
        </Typography>
        {emptyTransactions ? null : <Box sx={{ ml: "auto !important" }}>{newTransaction}</Box>}
      </Stack>
      <DepotTabs depotId={depot.id} value={tab} />
      <TabPanel tab={tab}>
        {tab === "transactions" ? (
          transactions.length === 0 ? (
            <Card>
              <CardContent>
                <Typography sx={{ mb: 2 }}>Noch keine Buchungen.</Typography>
                {newTransaction}
              </CardContent>
            </Card>
          ) : (
            <TransactionList transactions={transactions} />
          )
        ) : (
          <Card>
            <CardContent>
              <Typography color="text.secondary">Dieser Bereich folgt in einer späteren Version.</Typography>
            </CardContent>
          </Card>
        )}
      </TabPanel>
    </>
  );
}
