import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { AllocationView } from "@/app/_components/analyses/AllocationView";
import { AnalysisFilters } from "@/app/_components/analyses/AnalysisFilters";
import { AnalysisTabs } from "@/app/_components/analyses/AnalysisTabs";
import {
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
import { listClassifications } from "@/modules/classification";
import { listDepots, listPositions } from "@/modules/ledger";
import { latestStoredPrices } from "@/modules/prices";

export const metadata: Metadata = { title: "Analysen" };

type Props = {
  searchParams?: Promise<{ tab?: string | string[]; scope?: string | string[]; dimension?: string | string[] }>;
};

/**
 * Analysen (FR-21). Aufteilung: a today snapshot of the Portfolio (non-archived Depots, AD-17) or one
 * Depot, grouped by a classification dimension read through the classification module (AD-20); the
 * same Position values and cash as the composition card. Nothing is stored; no provider call.
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
  const inScope = scope === PORTFOLIO_SCOPE ? depots : depots.filter((depot) => depot.id === scope);
  const today = businessDate(new Date());
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
    <>
      <PageTitle>Analysen</PageTitle>
      <AnalysisTabs value={tab} scope={scope} dimension={dimension} />
      <Box role="tabpanel" id={analysisTabPanelId(tab)} aria-labelledby={analysisTabId(tab)}>
        <AnalysisFilters depots={depots.map(({ id, name }) => ({ id, name }))} scope={scope} dimension={dimension} />
        <AllocationView
          scope={scope}
          dimensionLabel={ALLOCATION_DIMENSIONS[dimension]}
          segments={result.segments}
          positions={result.positions}
          showDepot={scope === PORTFOLIO_SCOPE}
        />
      </Box>
    </>
  );
}
