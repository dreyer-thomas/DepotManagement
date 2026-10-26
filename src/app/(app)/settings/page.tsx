import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { ExportButton } from "@/app/_components/backup/ExportButton";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { DepotGroups } from "@/app/_components/depots/DepotList";
import { ParqetMigrationLink } from "@/app/_components/migration/ParqetMigrationLink";
import { PageTitle } from "@/app/_components/Placeholder";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const depots = await listDepots();
  return (
    <>
      <PageTitle>Einstellungen</PageTitle>
      <Box component="section" aria-labelledby="settings-depots">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2 }}>
          <Typography id="settings-depots" component="h2" variant="h6" sx={{ fontWeight: 600 }}>
            Depots
          </Typography>
          <CreateDepotButton variant="outlined" />
        </Box>
        {depots.length === 0 ? (
          <Card>
            <CardContent>
              <Typography>Noch kein Depot.</Typography>
            </CardContent>
          </Card>
        ) : (
          <DepotGroups depots={depots} settings />
        )}
      </Box>
      <Box component="section" aria-labelledby="settings-parqet" sx={{ mt: 4 }}>
        <Typography id="settings-parqet" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
          Parqet-Migration
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Übernimm die Buchungen eines Parqet-Portfolios aus dessen CSV-Export in ein Depot.
        </Typography>
        <ParqetMigrationLink />
      </Box>
      <Box component="section" aria-labelledby="settings-backup" sx={{ mt: 4 }}>
        <Typography id="settings-backup" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
          Datensicherung
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Lade alle Daten als JSON-Datei herunter: Depots, Buchungen, Kurse und hochgeladene Logos.
        </Typography>
        <ExportButton />
      </Box>
    </>
  );
}
