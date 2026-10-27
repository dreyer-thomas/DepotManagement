import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { AllocationView } from "@/app/_components/analyses/AllocationView";
import { AnalysisFilters } from "@/app/_components/analyses/AnalysisFilters";
import { AnalysisTabs } from "@/app/_components/analyses/AnalysisTabs";
import { DividendsView } from "@/app/_components/analyses/DividendsView";
import { GainsView } from "@/app/_components/analyses/GainsView";
import { ReturnHeatmap } from "@/app/_components/analyses/ReturnHeatmap";
import {
  type AllocationDimension,
  ALLOCATION_DIMENSIONS,
  ALLOCATION_LABELS,
  PORTFOLIO_SCOPE,
  allocationDimension,
  allocationHoldings,
  analysisScope,
  analysisTab,
  analysisTabId,
  analysisTabPanelId,
} from "@/app/_components/analyses/labels";
import { compositionHoldings } from "@/app/_components/composition/labels";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { PageTitle } from "@/app/_components/Placeholder";
import { allocation } from "@/core/allocation";
import { businessDate } from "@/core/dates";
import { dividendAnalysis } from "@/core/dividend-analysis";
import { gainsAnalysis } from "@/core/gains-analysis";
import { returnHeatmap } from "@/core/return-heatmap";
import { listClassifications } from "@/modules/classification";
import { gainsInput, listDepots, listPositions, listSecurities, returnSeries } from "@/modules/ledger";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";

export const metadata: Metadata = { title: "Analysen" };

type Props = {
  searchParams?: Promise<{ tab?: string | string[]; scope?: string | string[]; dimension?: string | string[] }>;
};

type Depot = Awaited<ReturnType<typeof listDepots>>[number];

/**
 * Aufteilung: a today snapshot of the Portfolio (non-archived Depots, AD-17) or one Depot, grouped by
 * a classification dimension read through the classification module (AD-20); the same Position values
 * and cash as the composition card.
 */
async function allocationPanel({ depots, scope, dimension, today }: { depots: Depot[]; scope: string; dimension: AllocationDimension; today: string }) {
  const inScope = scope === PORTFOLIO_SCOPE ? depots : depots.filter((depot) => depot.id === scope);
  const [positionsByDepot, classifications] = await Promise.all([
    // Stored manual / provider Prices win over Transaction prices (resolver), as on the Positions tab.
    Promise.all(inScope.map((depot) => listPositions(depot.id, today, undefined, { storedPrices: latestStoredPrices }))),
    listClassifications(),
  ]);
  const holdings = inScope.flatMap((depot, index) => compositionHoldings(depot, positionsByDepot[index]));
  const result = allocation(
    allocationHoldings(holdings, classifications, dimension),
    inScope.map((depot) => depot.cashBalance),
    ALLOCATION_LABELS,
  );
  return (
    <AllocationView
      scope={scope}
      dimensionLabel={ALLOCATION_DIMENSIONS[dimension]}
      segments={result.segments}
      positions={result.positions}
      showDepot={scope === PORTFOLIO_SCOPE}
    />
  );
}

/**
 * Rendite: monthly TTWRORs over the scope's MAX daily series (the same series and flows as the Depot /
 * Portfolio return figures), chained into quarters and years (FR-22).
 */
async function returnsPanel({ scope, today }: { scope: string; today: string }) {
  const { start, series, rows } = await returnSeries(scope === PORTFOLIO_SCOPE ? "portfolio" : { depotId: scope }, today, undefined, {
    storedPrices: storedPriceHistory,
  });
  return <ReturnHeatmap scope={scope} years={returnHeatmap(start, series, rows, today)} />;
}

/**
 * Gewinne: realized gains (FIFO per Depot), dividends, fees, taxes and net Kapitalfluss per month and
 * year of the scope's ledger (FR-22), from one core function.
 */
async function gainsPanel({ scope, today }: { scope: string; today: string }) {
  const { depots, actions, securityNames } = await gainsInput(scope === PORTFOLIO_SCOPE ? "portfolio" : { depotId: scope });
  return <GainsView analysis={gainsAnalysis(depots, actions, today)} securityNames={securityNames} today={today} />;
}

/**
 * Dividenden: payments per month / year / Security, trailing-12-month income and yield over today's
 * paying Positions (stored Prices, as on the Aufteilung tab) and the next 12 months' estimate (FR-22),
 * plus the per-Security monthly split, year lines, forecast and yield on cost (today's Cost Basis), from
 * one core function. Security metadata (ISIN, symbol, type) feeds the Breakdown selector.
 */
async function dividendsPanel({ scope, today }: { scope: string; today: string }) {
  const [{ depots, actions, securityNames }, securityList] = await Promise.all([
    gainsInput(scope === PORTFOLIO_SCOPE ? "portfolio" : { depotId: scope }),
    listSecurities(),
  ]);
  const positionsByDepot = await Promise.all(
    depots.map((depot) => listPositions(depot.depotId, today, undefined, { storedPrices: latestStoredPrices })),
  );
  const inputs = depots.map((depot, index) => ({
    ...depot,
    positions: positionsByDepot[index].map((position) => ({
      securityId: position.security.id,
      quantity: position.quantity,
      value: position.value,
      costBasis: position.costBasis,
    })),
  }));
  const securities = Object.fromEntries(
    securityList.map((security) => [security.id, { name: security.name, isin: security.isin, cryptoSymbol: security.cryptoSymbol, assetType: security.assetType }]),
  );
  return (
    <DividendsView
      analysis={dividendAnalysis(inputs, actions, today)}
      securityNames={securityNames}
      today={today}
      depotId={scope === PORTFOLIO_SCOPE ? null : scope}
      securities={securities}
    />
  );
}

/**
 * Analysen (FR-21, FR-22): tabs Aufteilung, Rendite, Gewinne and Dividenden over the Portfolio or one non-archived Depot,
 * scope (and dimension) in the URL. Everything is computed on read; nothing is stored; no provider call.
 */
export default async function AnalysesPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const all = await listDepots();
  // Archived Depots are left out of every aggregate and cannot be chosen as scope (AD-17).
  const depots = all.filter((depot) => !depot.archived);
  if (depots.length === 0) {
    return (
      <>
        <PageTitle>Analysen</PageTitle>
        <Card>
          <CardContent>
            <Typography sx={{ mb: 1 }}>{all.length === 0 ? "Noch kein Depot." : "Alle Depots sind archiviert."}</Typography>
            <AppLink href="/depots">Zu den Depots</AppLink>
          </CardContent>
        </Card>
      </>
    );
  }

  const tab = analysisTab(params.tab);
  const scope = analysisScope(params.scope, depots.map((depot) => depot.id));
  const dimension = allocationDimension(params.dimension);
  const today = businessDate(new Date());

  return (
    <>
      <PageTitle>Analysen</PageTitle>
      <AnalysisTabs value={tab} scope={scope} dimension={dimension} />
      <Box role="tabpanel" id={analysisTabPanelId(tab)} aria-labelledby={analysisTabId(tab)}>
        <AnalysisFilters tab={tab} depots={depots.map(({ id, name }) => ({ id, name }))} scope={scope} dimension={dimension} />
        {tab === "returns" ? (
          await returnsPanel({ scope, today })
        ) : tab === "gains" ? (
          await gainsPanel({ scope, today })
        ) : tab === "dividends" ? (
          await dividendsPanel({ scope, today })
        ) : (
          await allocationPanel({ depots, scope, dimension, today })
        )}
      </Box>
    </>
  );
}
