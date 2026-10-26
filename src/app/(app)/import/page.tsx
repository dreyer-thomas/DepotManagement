import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { brokerLabel } from "@/app/_components/depots/labels";
import { batchSummary } from "@/app/_components/import/labels";
import { UploadDropzone } from "@/app/_components/import/UploadDropzone";
import { PageTitle } from "@/app/_components/Placeholder";
import { formatDateTime } from "@/core/format";
import { listOpenBatches } from "@/modules/import";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Import" };

type Props = { searchParams?: Promise<{ depot?: string | string[] }> };

export default async function ImportPage({ searchParams }: Props) {
  const requested = (await searchParams)?.depot;
  const [depots, batches] = await Promise.all([listDepots(), listOpenBatches()]);
  // Only non-archived Depots accept uploads (AD-17); an unknown `?depot=` falls back to the first.
  const active = depots.filter((depot) => !depot.archived).map((depot) => ({ id: depot.id, name: depot.name }));
  return (
    <>
      <PageTitle>Import</PageTitle>
      <Card component="section" aria-labelledby="import-upload-title" sx={{ mb: 2 }}>
        <CardContent>
          <Typography id="import-upload-title" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Dokumente hochladen
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Abrechnungen und Gutschriften als PDF hochladen. Erkannte Buchungen werden erst nach der Prüfung gebucht.
          </Typography>
          <UploadDropzone depots={active} defaultDepotId={typeof requested === "string" ? requested : undefined} />
        </CardContent>
      </Card>
      <Card component="section" aria-labelledby="import-open-title">
        <CardContent>
          <Typography id="import-open-title" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Offene Importe
          </Typography>
          {batches.length === 0 ? (
            <Typography color="text.secondary">Keine offenen Importe.</Typography>
          ) : (
            <List disablePadding>
              {batches.map((batch) => (
                <ListItem key={batch.id} disableGutters divider>
                  <ListItemText
                    primary={
                      <AppLink href={`/import/${encodeURIComponent(batch.id)}`}>
                        {batch.depotName} · {brokerLabel(batch.broker)}
                      </AppLink>
                    }
                    secondary={`${batchSummary(batch)} · hochgeladen am ${formatDateTime(batch.createdAt)}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>
    </>
  );
}
