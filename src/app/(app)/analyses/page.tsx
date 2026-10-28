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
import { TargetAllocationView } from "@/app/_components/rebalancing/TargetAllocationView";
import { parseDepositParam } from "@/app/_components/rebalancing/labels";
import { TaxView } from "@/app/_components/tax/TaxView";
import {
  type AllocationDimension,
  ALLOCATION_DIMENSIONS,
  PORTFOLIO_SCOPE,
  allocationDimension,
  analysisScope,
  analysisTab,
  analysisTabId,
  analysisTabPanelId,
} from "@/app/_components/analyses/labels";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { PageTitle } from "@/app/_components/Placeholder";
import { businessDate } from "@/core/dates";
import { dividendAnalysis } from "@/core/dividend-analysis";
import { gainsAnalysis } from "@/core/gains-analysis";
import { type RebalancingHolding, rebalancing } from "@/core/rebalancing";
import { returnHeatmap } from "@/core/return-heatmap";
import { taxPreview } from "@/core/tax";
import { allocationAnalysis, listClassifications, listRegionSplits } from "@/modules/classification";
import { dividendAnalysisInput, gainsInput, listDepots, listPositions, returnSeries } from "@/modules/ledger";
import { latestStoredPrices, storedPriceHistory } from "@/modules/prices";
import { getTargetAllocation } from "@/modules/rebalancing";
import { taxPreviewInput } from "@/modules/tax";

export const metadata: Metadata = { title: "Analysen" };

type Props = {
  searchParams?: Promise<{ tab?: string | string[]; scope?: string | string[]; dimension?: string | string[]; deposit?: string | string[] }>;
};

type Depot = Awaited<ReturnType<typeof listDepots>>[number];

/**
 * Aufteilung: a today snapshot of the Portfolio (non-archived Depots, AD-17) or one Depot, grouped by
 * a classification dimension read through the classification module (AD-20); the same Position values
 * and cash as the composition card. By "Region", a fund's value is distributed by its region split.
 */
async function allocationPanel({ scope, dimension, today }: { scope: string; dimension: AllocationDimension; today: string }) {
  // Stored manual / provider Prices win over Transaction prices (resolver), as on the Positions tab.
  const result = await allocationAnalysis(scope === PORTFOLIO_SCOPE ? "portfolio" : { depotId: scope }, dimension, today, undefined, {
    storedPrices: latestStoredPrices,
  });
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
 * plus the per-Security monthly split, year lines and forecast, from one core function.
 */
async function dividendsPanel({ scope, today }: { scope: string; today: string }) {
  const { depots, actions, securityNames } = await dividendAnalysisInput(scope === PORTFOLIO_SCOPE ? "portfolio" : { depotId: scope }, today, undefined, {
    storedPrices: latestStoredPrices,
  });
  return (
    <DividendsView
      analysis={dividendAnalysis(depots, actions, today)}
      securityNames={securityNames}
      today={today}
      depotId={scope === PORTFOLIO_SCOPE ? null : scope}
    />
  );
}

/**
 * Steuern (story 8.3): the capital-gains tax estimate per broker and year over every Depot (archived
 * included: taxes follow the sale date), from one core function; the tax category of each Security comes
 * from its classification and Teilfreistellung override (`taxPreviewInput`). Independent of the scope.
 */
async function taxesPanel({ today }: { today: string }) {
  const input = await taxPreviewInput();
  return <TaxView years={taxPreview({ ...input, today })} today={today} />;
}

/**
 * Zielallokation (story 8.5): today's priced Positions (stored Prices, as on the Aufteilung tab) and cash of
 * the scope mapped to the ten segments via the classification module (funds by their region split), the
 * scope's stored targets and an advisory rebalancing proposal for an optional `?deposit=`, whose sells are
 * taxed with the tax module's input (every Depot of the broker). Computed on read; nothing is booked.
 */
async function targetsPanel({ depots, all, scope, today, depositParam }: { depots: Depot[]; all: Depot[]; scope: string; today: string; depositParam: string | string[] | undefined }) {
  const inScope = scope === PORTFOLIO_SCOPE ? depots : depots.filter((depot) => depot.id === scope);
  const [positionsByDepot, classifications, regionSplits, tax, allocation] = await Promise.all([
    Promise.all(inScope.map((depot) => listPositions(depot.id, today, undefined, { storedPrices: latestStoredPrices }))),
    listClassifications(),
    listRegionSplits(),
    taxPreviewInput(),
    getTargetAllocation(scope),
  ]);
  const securityNames: Record<string, string> = {};
  const holdings: RebalancingHolding[] = inScope.flatMap((depot, index) =>
    positionsByDepot[index].flatMap((position) => {
      if (position.value === null || position.price === null) return [];
      const { id, name, assetType } = position.security;
      securityNames[id] = name;
      const classification = classifications[id];
      return [
        {
          securityId: id,
          depotId: depot.id,
          quantity: position.quantity,
          price: position.price,
          value: position.value,
          classification: {
            type: classification?.type ?? assetType,
            assetClass: classification?.assetClass.value ?? null,
            region: classification?.region.value ?? null,
            country: classification?.country.value ?? null,
          },
          split: regionSplits[id]?.effective?.weights ?? null,
        },
      ];
    }),
  );
  const { deposit, invalid, text } = parseDepositParam(depositParam);
  const result = rebalancing({
    holdings,
    cash: inScope.map((depot) => ({ depotId: depot.id, value: depot.cashBalance })),
    targets: allocation,
    deposit,
    tax,
    today,
  });
  return (
    <TargetAllocationView
      scope={scope}
      result={result}
      allocation={allocation}
      securityNames={securityNames}
      depotNames={Object.fromEntries(all.map((depot) => [depot.id, depot.name]))}
      depositText={text}
      depositInvalid={invalid}
    />
  );
}

/**
 * Analysen (FR-21, FR-22): tabs Aufteilung, Rendite, Gewinne, Dividenden, Steuern and Zielallokation over the Portfolio or one non-archived Depot,
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
        ) : tab === "taxes" ? (
          await taxesPanel({ today })
        ) : tab === "targets" ? (
          await targetsPanel({ depots, all, scope, today, depositParam: params.deposit })
        ) : (
          await allocationPanel({ scope, dimension, today })
        )}
      </Box>
    </>
  );
}
