import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/core/format";
import type { DepotSummary } from "@/modules/ledger";
import { RenameDepotButton } from "./DepotDialogs";
import { DepotLink } from "./DepotLink";
import { brokerLabel } from "./labels";

/** Depot cards: name (link to the detail page), Broker and Cash Account balance. */
export function DepotList({ depots, renamable = false }: { depots: DepotSummary[]; renamable?: boolean }) {
  return (
    <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {depots.map((depot) => (
        <li key={depot.id}>
          <Card>
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, "&:last-child": { pb: 2 } }}>
              <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
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
              {renamable ? <RenameDepotButton depot={depot} /> : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </Stack>
  );
}
