import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { AppLink } from "@/app/_components/depots/DepotLink";
import { DepotList } from "@/app/_components/depots/DepotList";
import { ParqetMigrationLink } from "@/app/_components/migration/ParqetMigrationLink";
import { PageTitle } from "@/app/_components/Placeholder";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Übersicht" };

export default async function OverviewPage() {
  const all = await listDepots();
  if (all.length === 0) {
    return (
      <>
        <PageTitle>Übersicht</PageTitle>
        <Card>
          <CardContent>
            <Typography sx={{ mb: 2 }}>Noch kein Depot.</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <CreateDepotButton label="Depot anlegen" />
              <ParqetMigrationLink />
            </Stack>
          </CardContent>
        </Card>
      </>
    );
  }
  // Archived Depots are left out of the Overview (AD-17).
  const depots = all.filter((depot) => !depot.archived);
  if (depots.length === 0) {
    return (
      <>
        <PageTitle>Übersicht</PageTitle>
        <Card>
          <CardContent>
            <Typography sx={{ mb: 1 }}>Alle Depots sind archiviert.</Typography>
            <AppLink href="/depots">Zu den Depots</AppLink>
          </CardContent>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageTitle>Übersicht</PageTitle>
      <DepotList depots={depots} />
    </>
  );
}
