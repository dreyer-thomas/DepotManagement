import ExpandMore from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { formatMoney } from "@/core/format";
import type { DepotSummary } from "@/modules/ledger";
import { SparklineChart } from "../charts/SparklineChart";
import { ReturnValue } from "../overview/DepotPerformance";
import { GainLossPill } from "../positions/GainLossPill";
import { ArchiveDepotButton, DeleteDepotButton, RenameDepotButton, UnarchiveDepotButton } from "./DepotDialogs";
import { DepotLink } from "./DepotLink";
import { brokerLabel } from "./labels";

/** Settings mode actions: rename + archive + delete for an active Depot, "Reaktivieren" + delete for an archived one. */
function SettingsActions({ depot, reasonId }: { depot: DepotSummary; reasonId: string }) {
  if (depot.archived) {
    return (
      <Stack direction="row" sx={{ ml: "auto", flexShrink: 0, alignItems: "flex-start", gap: 0.5 }}>
        <UnarchiveDepotButton depot={depot} />
        <DeleteDepotButton depot={depot} />
      </Stack>
    );
  }
  return (
    <Stack direction="row" sx={{ flexShrink: 0 }}>
      <RenameDepotButton depot={depot} />
      <ArchiveDepotButton depot={depot} describedBy={reasonId} />
      <DeleteDepotButton depot={depot} />
    </Stack>
  );
}

/** A Depot's Period figures for its card on the Depots page (decimal strings; ratios `null` when unknown). */
export type DepotFigures = {
  value: string;
  positionsValue: string;
  cash: string;
  positionCount: number;
  gain: string;
  dividends: string;
  ttwror: string | null;
  xirr: string | null;
  /** Daily total values over the Period, for the sparkline. */
  values: string[];
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="p" noWrap>
        {label}
      </Typography>
      <Typography variant="figure" component="p" noWrap>
        {children}
      </Typography>
    </Box>
  );
}

/**
 * The figures card of an active Depot. md+: one row — name and Broker, sparkline (≈ 20 %), a 3 × 2
 * stat grid, value with Period Gain/Loss. Below md: name and value on top, then a slim sparkline and
 * the stat grid.
 */
function FiguresCard({ depot, figures, periodLabel }: { depot: DepotSummary; figures: DepotFigures; periodLabel: string }) {
  return (
    <Card>
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Box
          sx={{
            display: "grid",
            alignItems: "center",
            columnGap: 3,
            rowGap: 1.5,
            gridTemplateColumns: { xs: "minmax(0, 1fr) auto", md: "minmax(0, 1fr) 20% minmax(0, 2.2fr) auto" },
            gridTemplateAreas: { xs: '"name value" "spark spark" "stats stats"', md: '"name spark stats value"' },
          }}
        >
          <Stack sx={{ gridArea: "name", minWidth: 0 }}>
            <Typography component="p" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
              <DepotLink id={depot.id}>{depot.name}</DepotLink>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {brokerLabel(depot.broker)}
            </Typography>
          </Stack>
          <Box sx={{ gridArea: "spark", minWidth: 0 }}>
            <SparklineChart values={figures.values} height={48} />
          </Box>
          <Box
            sx={{
              gridArea: "stats",
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" },
              columnGap: 2,
              rowGap: 1,
            }}
          >
            <Stat label="Wertpapiere">{formatMoney(figures.positionsValue)}</Stat>
            <Stat label="Cash-Konto">{formatMoney(figures.cash)}</Stat>
            <Stat label="Positionen">{figures.positionCount}</Stat>
            <Stat label={`Dividenden · ${periodLabel}`}>{formatMoney(figures.dividends)}</Stat>
            <Stat label={`TTWROR · ${periodLabel}`}>
              <ReturnValue ratio={figures.ttwror} />
            </Stat>
            <Stat label={`XIRR · ${periodLabel}`}>
              <ReturnValue ratio={figures.xirr} />
            </Stat>
          </Box>
          <Stack sx={{ gridArea: "value", alignItems: "flex-end", gap: 0.5 }}>
            <Typography variant="figureKpi" sx={{ whiteSpace: "nowrap" }}>
              {formatMoney(figures.value)}
            </Typography>
            <GainLossPill gain={figures.gain} ratio={null} />
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * Depot cards: name (link to the detail page), Broker and Cash Account balance. In Settings mode
 * each card also gets its write actions (rename/archive/delete, or reactivate/delete when archived).
 * A Depot with `figures` (Depots page, active Depots) gets the taller figures card instead.
 */
export function DepotList({
  depots,
  settings = false,
  figures,
  periodLabel = "",
}: {
  depots: DepotSummary[];
  settings?: boolean;
  figures?: Record<string, DepotFigures>;
  periodLabel?: string;
}) {
  return (
    <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {depots.map((depot) => {
        const own = settings ? undefined : figures?.[depot.id];
        if (own) {
          return (
            <li key={depot.id}>
              <FiguresCard depot={depot} figures={own} periodLabel={periodLabel} />
            </li>
          );
        }
        const reasonId = `depot-archive-blocked-${depot.id}`;
        const blocked = settings && !depot.archived && !depot.archivable;
        // The wider "Reaktivieren" button wraps below name and balance on narrow screens.
        const wraps = settings && depot.archived;
        return (
          <li key={depot.id}>
            <Card>
              <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                <Stack direction="row" sx={{ alignItems: "center", gap: 2, flexWrap: wraps ? "wrap" : "nowrap" }}>
                  <Stack sx={{ flexGrow: 1, minWidth: wraps ? "8rem" : 0 }}>
                    <Typography component="p" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                      <DepotLink id={depot.id}>{depot.name}</DepotLink>
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {brokerLabel(depot.broker)}
                    </Typography>
                  </Stack>
                  <Stack sx={{ alignItems: "flex-end", flexShrink: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      Cash-Konto
                    </Typography>
                    <Typography variant="figure">{formatMoney(depot.cashBalance)}</Typography>
                  </Stack>
                  {settings ? <SettingsActions depot={depot} reasonId={reasonId} /> : null}
                </Stack>
                {blocked ? (
                  <Typography id={reasonId} variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Depot hat noch Positionen oder Guthaben.
                  </Typography>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </Stack>
  );
}

/**
 * Active Depots, then (when any exist) a collapsed "Archiviert (n)" group with the archived ones.
 * Expects at least one Depot; the caller shows the empty state. `figures` (keyed by Depot id) turn the
 * matching cards into figures cards.
 */
export function DepotGroups({
  depots,
  settings = false,
  figures,
  periodLabel,
}: {
  depots: DepotSummary[];
  settings?: boolean;
  figures?: Record<string, DepotFigures>;
  periodLabel?: string;
}) {
  const active = depots.filter((depot) => !depot.archived);
  const archived = depots.filter((depot) => depot.archived);
  return (
    <Stack spacing={2}>
      {active.length > 0 ? <DepotList depots={active} settings={settings} figures={figures} periodLabel={periodLabel} /> : null}
      {archived.length > 0 ? (
        <Accordion disableGutters sx={{ "&::before": { display: "none" } }}>
          <AccordionSummary id="archived-depots-header" aria-controls="archived-depots-content" expandIcon={<ExpandMore />} sx={{ minHeight: 48 }}>
            <Typography component="span" sx={{ fontWeight: 600 }}>
              Archiviert ({archived.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: { xs: 1, sm: 2 } }}>
            <DepotList depots={archived} settings={settings} />
          </AccordionDetails>
        </Accordion>
      ) : null}
    </Stack>
  );
}
