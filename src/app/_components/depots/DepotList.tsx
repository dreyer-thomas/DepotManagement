import ExpandMore from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/core/format";
import type { DepotSummary } from "@/modules/ledger";
import { ArchiveDepotButton, RenameDepotButton, UnarchiveDepotButton } from "./DepotDialogs";
import { DepotLink } from "./DepotLink";
import { brokerLabel } from "./labels";

/** Settings mode actions: rename + archive for an active Depot, "Reaktivieren" for an archived one. */
function SettingsActions({ depot, reasonId }: { depot: DepotSummary; reasonId: string }) {
  if (depot.archived) {
    return (
      <Box sx={{ ml: "auto", flexShrink: 0 }}>
        <UnarchiveDepotButton depot={depot} />
      </Box>
    );
  }
  return (
    <Stack direction="row" sx={{ flexShrink: 0 }}>
      <RenameDepotButton depot={depot} />
      <ArchiveDepotButton depot={depot} describedBy={reasonId} />
    </Stack>
  );
}

/**
 * Depot cards: name (link to the detail page), Broker and Cash Account balance. In Settings mode
 * each card also gets its write actions (rename/archive, or reactivate when archived).
 */
export function DepotList({ depots, settings = false }: { depots: DepotSummary[]; settings?: boolean }) {
  return (
    <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {depots.map((depot) => {
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
 * Expects at least one Depot; the caller shows the empty state.
 */
export function DepotGroups({ depots, settings = false }: { depots: DepotSummary[]; settings?: boolean }) {
  const active = depots.filter((depot) => !depot.archived);
  const archived = depots.filter((depot) => depot.archived);
  return (
    <Stack spacing={2}>
      {active.length > 0 ? <DepotList depots={active} settings={settings} /> : null}
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
